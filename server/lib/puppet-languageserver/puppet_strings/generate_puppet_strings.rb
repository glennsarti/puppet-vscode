require 'puppet-strings'
require 'puppet-strings/yard'
require 'puppet-strings/markdown'

module PuppetLanguageServer
  module PuppetStrings
    @yard_setup = false

    DEFAULT_SEARCH_PATTERNS = %w(
      manifests/**/*.pp
      functions/**/*.pp
      types/**/*.pp
      lib/**/*.rb
    ).freeze

    def self.render(options = {})
      return "Puppet Strings can only be generated within a module workspace" if options[:workspace].nil?

      search_patterns = options[:search_patterns].nil? ? PuppetStrings::DEFAULT_SEARCH_PATTERNS : options[:search_patterns]
      # Munge the search patterns to the local workspace
      search_patterns = search_patterns.map { |pattern| File.join(options[:workspace], pattern) }

      unless @yard_setup
        ::PuppetStrings::Yard.setup!
        @yard_setup = true
      end

      # Format the arguments to YARD
      args = ['doc']
      args << '--debug'     if options[:debug]
      args << '--backtrace' if options[:backtrace]
      args << "-mmarkdown}"

      args << '-n'
      args << '-q'
      args << '--no-stats'
      args << '--no-progress'

      yard_args = options[:yard_args]


      args += yard_args if yard_args
      args += search_patterns

      # Run YARD
      # TODO: HRMM...need to delete the yard tmp files....
      ::YARD::CLI::Yardoc.run(*args)
      markdown = ::PuppetStrings::Markdown.generate

      markdown
    end
  end
end
