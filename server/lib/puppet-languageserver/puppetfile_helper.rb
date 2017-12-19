require 'r10k/puppetfile'

module PuppetLanguageServer
  module PuppetfileHelper
    def self.load_puppetfile(content)
      puppetfile =  R10K::Puppetfile.new('<vscode>')
      dsl = R10K::Puppetfile::DSL.new(puppetfile)
      dsl.instance_eval(content, 'Puppetfile')

      puppetfile
    end
  end
end
