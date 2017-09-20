#!/usr/bin/env ruby

# Add the language server into the load path
root = File.join(File.dirname(__FILE__),'..') 

$LOAD_PATH.unshift(File.join(root,'lib'))
# #reject{ |o| !File.directory?(o)}
vendor_dir = File.join(root,'vendor')
Dir.new(vendor_dir)
  .reject{ |v| v == '.' || v == '..'}
  .map{ |v| File.join(vendor_dir,v) }
  .reject{ |v| !File.directory?(v)}
  .each do |vendor|
    $LOAD_PATH.unshift(File.join(vendor,'lib'))
end

require 'pp'
module_root = 'C:\source\puppetlabs-iis\iis'
puts "---- #{module_root}"

require 'puppet-strings'
options = {
  :patterns => PuppetStrings::DEFAULT_SEARCH_PATTERNS,
  :debug => nil,
  :backtrace => nil,
  :markup => nil,
  :json => nil, #'C:\source\puppet-vscode\server\tmp\string-test.json',
  :yard_args => nil,
}

module_root.gsub!(/\\/,"/")
options[:patterns] = options[:patterns].collect { |pattern| module_root + '/' + pattern }

string_options = {
  debug: options[:debug] == 'true',
  backtrace: options[:backtrace] == 'true',
  markup: options[:markup] || 'markdown',
}

string_options[:json] = options[:json] unless options[:json].nil?
string_options[:yard_args] = options[:yard_args].split unless options[:yard_args].nil?

result = PuppetStrings.generate(options[:patterns], string_options)
require 'pry'; binding.pry
puts result



# # Implements the strings:generate task.
# namespace :strings do
#   desc 'Generate Puppet documentation with YARD.'
#   task :generate, :patterns, :debug, :backtrace, :markup, :json, :yard_args do |t, args|
#     patterns = args[:patterns]
#     patterns = patterns.split if patterns
#     patterns ||= PuppetStrings::DEFAULT_SEARCH_PATTERNS

#     options = {
#       debug: args[:debug] == 'true',
#       backtrace: args[:backtrace] == 'true',
#       markup: args[:markup] || 'markdown',
#     }

#     options[:json] = args[:json] if args.key? :json
#     options[:yard_args] = args[:yard_args].split if args.key? :yard_args

#     PuppetStrings.generate(patterns, options)
#   end
# end

