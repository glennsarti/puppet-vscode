require 'r10k/puppetfile'

module PuppetLanguageServer
  module R10K
    module Puppetfile
      PUPPETFILE_MONIKER          ||= 'Puppetfile'.freeze
      MAX_LINE_LENGTH             ||= 1000.freeze

      # TODO this will eventually disappear into r10k code
      def self.load_puppetfile(content)
        puppetfile =  ::R10K::Puppetfile.new('<vscode>')
        dsl = ::R10K::Puppetfile::DSL.new(puppetfile)
        dsl.instance_eval(content, PUPPETFILE_MONIKER)

        puppetfile
      end
    end
  end
end




# result << LanguageServer::Diagnostic.create('severity' => severity,
# 'code' => problem[:check].to_s,
# 'fromline' => problem[:line] - 1,   # Line numbers from puppet are base 1
# 'toline' => problem[:line] - 1,     # Line numbers from puppet are base 1
# 'fromchar' => problem[:column] - 1, # Pos numbers from puppet are base 1
# 'tochar' => endpos,
# 'source' => 'Puppet',
# 'message' => problem[:message])
