# Due to namespacing issue in PSON, need to require puppet first and then the parser
require 'puppet'
require 'parser/current'

module PuppetLanguageServer
  module PuppetRubyHelper

    class FauxPuppetType
      attr_accessor :name
      attr_accessor :doc
      # https://github.com/puppetlabs/puppet/blob/c4f42549261d57d2b839d265f1d48dd9cc1fcfc3/lib/puppet/type.rb#L130-L138
      attr_accessor :allattrs

      def initialize
        @allattrs = []
      end
    end

    # public
    def self.extract_puppet_types_from_ruby(filename)
      extract_puppet_types_from_content(File.open(filename, "r:UTF-8") { |f| f.read })
    end

    def self.extract_puppet_types_from_content(file_content)
      parsed = Parser::CurrentRuby.parse(file_content)

      types = []

      # Find statements like;
      # 'Puppet::Type.newtype(:file) do'
      recurse_find_all_nodes_with_type(:block, parsed) do |node|
        node.children.select { |s| !s.nil? && s.type == :send }.each do |typenode|
          parent, methodname, args = extract_send(typenode)
          if parent == 'Puppet::Type' && methodname == 'newtype' && args.count >= 1
            fpt = FauxPuppetType.new
            fpt.name = args[0].children[0]
            populate_faux_puppet_type(fpt, node)
            types << fpt
            # require 'pry'; binding.pry
            # puts "!!!"
          end
        end
      end

      # Find statements like;
      # module Puppet
      #   Type.newtype(:exec) do
      recurse_find_all_nodes_with_type(:module, parsed, 3) do |module_node|
        recurse_find_all_nodes_with_type(:block, module_node) do |node|
          node.children.select { |s| !s.nil? && s.type == :send }.each do |typenode|
            parent, methodname, args = extract_send(typenode)
            if parent == 'Type' && methodname == 'newtype' && args.count >= 1
              fpt = FauxPuppetType.new
              fpt.name = args[0].children[0]
              populate_faux_puppet_type(fpt, node)
              types << fpt
                # require 'pry'; binding.pry
              # puts "!!!"
            end
          end
        end
      end

      # Remove any types called component or whit
      # These are internal to Puppet and should not be exposed to users
      types.reject! { |t| t.name == :whit || t.name == :component }

      types
    end

    def self.populate_faux_puppet_type(fpt, node)
      recurse_find_all_nodes_with_type(:block, node, 0) do |block_node|

        # Find the documentation assignment
        recurse_find_all_nodes_with_type(:ivasgn, block_node, 2) do |iva_node|
          if iva_node.children[0] == :@doc
            fpt.doc = get_string_from_node(iva_node.children[1]).rstrip
          end
        end if fpt.doc.nil?

        # Find the documentation method call
        recurse_find_all_nodes_with_type(:send, block_node, 2) do |send_node|
          parent, methodname, args = extract_send(send_node)
          if parent.nil? && methodname == 'desc'
            fpt.doc = get_string_from_node(args[0]).rstrip
          end
        end if fpt.doc.nil?

      end
    end

    def self.get_string_from_node(node)
      return nil if node.nil?
      return node.children[0].strip if node.type == :str
      return node.children[0].to_s if node.type == :sym

      if node.type == :dstr
        # Convert the child :str into a single stripped string where the indentation is taken into account
        strip_length = -1
        return node.children.map do |s|
          munged = s.children[0]
          if strip_length == -1
            strip_length = s.children[0].index(/\S/) if s.children[0].start_with?(' ')
          end

          unless strip_length == -1
            if munged.length >= strip_length
              munged = munged.slice(strip_length, munged.length - strip_length)
            else
              munged = "\n"
            end
          end

          munged
        end.join
      end

      nil
    end

    def self.recurse_find_all_nodes_with_type(nodetype, node, max_depth = -1, depth = 0, &block)
      return unless node.is_a? AST::Node
      yield node if node.type == nodetype

      return unless max_depth == -1 || depth < max_depth
      node.children.each { |child| recurse_find_all_nodes_with_type(nodetype, child, max_depth, depth + 1, &block) }

      nil
    end

    # Rebuild a send method into its constiuent parts
    # 1 - Parent object
    # 2 - Method Name
    # 3 - Parameters/Arguments passed in the send
    def self.extract_send(node)
#puts "NODE #{node}"
      parent = recurse_constants(node.children[0])
      methodname = node.children[1].to_s
      args = node.children.slice(2, node.children.count - 2)

      return parent, methodname, args
    end

    # Recursively regenerates the original source text from a nested
    # constants AST e.g.
    # From
    #   (const
    #     (const nil :Puppet) :Type)
    # To
    #   Puppet::Type
    def self.recurse_constants(node, delim = '::')
      return if node.nil?
      return unless node.is_a? AST::Node
      return unless node.type == :const

      return node.children[1].to_s if node.children[0].nil?
      recurse_constants(node.children[0]).to_s + delim + node.children[1].to_s
    end
  end
end
