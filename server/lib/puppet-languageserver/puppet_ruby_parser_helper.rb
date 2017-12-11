# Due to namespacing issue in PSON, need to require puppet first and then the parser
require 'puppet'
require 'parser/current'

module PuppetLanguageServer
  module PuppetRubyHelper

    class FauxPuppetType
      attr_accessor :name
      attr_accessor :doc
      attr
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
          if parent == 'Puppet::Type' && methodname == 'newtype' && args.count == 1
            fpt = FauxPuppetType.new
            fpt.name = args[0].intern
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
            if parent == 'Type' && methodname == 'newtype' && args.count == 1
              fpt = FauxPuppetType.new
              fpt.name = args[0].intern
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

        require 'pry'; binding.pry
        puts "!!!"

        # Find the documentation assignment
        recurse_find_all_nodes_with_type(:ivasgn, block_node, 2) do |iva_node|
          if iva_node.children[0] == :@doc
            fpt.doc = get_string_from_node(iva_node.children[1])
          end
        end

        # TODO find the send call to desc
        # s(:send, nil, :desc,
        # s(:dstr,
        #   s(:str, "A resource type for creating new run stages.  Once a stage is available,\n"),
        #   s(:str, "    classes can be assigned to it by declaring them with the resource-like syntax\n"),
        #   s(:str, "    and using\n"),
        #   s(:str, "    [the `stage` metaparam

      end
    end

    def self.get_string_from_node(node)
      return node.children[0].strip if node.type == :str

      if node.type == :dstr
        # Convert the child :str into a single stripped string
        # TODO Don't just strip.  Only strip X chars based on the second or more nstance where there's text.
        return node.children.map { |s| s.children[0].strip }.join("\n")
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
      args = []

      index = 2
      while index < node.children.count
        child = node.children[index]
        case
        when child.is_a?(Parser::AST::Node) && child.type == :sym
          args << child.children[0].to_s
        when child.is_a?(Parser::AST::Node) && child.type == :hash
          # Do nothing - Hash
          # Example
          # => s(:hash,
          # s(:pair,
          #   s(:sym, :boolean),
          #   s(:true)),
          # s(:pair,
          #   s(:sym, :parent),
          #   s(:const,
          #     s(:const,
          #       s(:const, nil, :Puppet), :Parameter), :Boolean)))
        when child.is_a?(Parser::AST::Node) && child.type == :dstr
          # Do nothing - Docstring
          # Example
          # => s(:dstr,
          # s(:str, "A command for validating the file's syntax before replacing it. If\n"),
          # s(:str, "      Puppet would need to rewrite a file due to new `source` or `content`, it\n"),
          # s(:str, "      will check the new content's validity first. If validation fails, the file\n"),
          # s(:str, "      resource will fail.\n"),
        when child.is_a?(Parser::AST::Node) && child.type == :send
          # Do nothing - Nested send
        when child.is_a?(Parser::AST::Node) && child.type == :lvar
          # Do nothing - lvar !?!?
        else
          #require 'pry'; binding.pry
          #raise("Unable to parse #{child}")
        end
        index += 1
      end

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
