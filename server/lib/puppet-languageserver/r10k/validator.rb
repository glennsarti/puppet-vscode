require 'r10k/puppetfile'

module PuppetLanguageServer
  module R10K
    module Validator
      UNABLE_TO_VERIFY_ERROR_CODE ||= 1.freeze
      NONEXIST_ERROR_CODE         ||= 2.freeze
      UNMET_DEPENDENCY_ERROR_CODE ||= 3.freeze

      def self.max_line_length
        PuppetLanguageServer::R10K::Puppetfile::MAX_LINE_LENGTH
      end

      def self.validate_puppetfile(content, workspace, _max_problems = 100)
        result = []
        # TODO: Need to implement max_problems
        problems = 0

        # Attempt to parse the file
        puppetfile = nil
        begin
          puppetfile = PuppetLanguageServer::R10K::Puppetfile.load_puppetfile(content)
        rescue StandardError => detail
          # Find the originating error from within the puppetfile
          loc = detail.backtrace_locations
                  .select { |loc| loc.absolute_path == PuppetLanguageServer::R10K::Puppetfile::PUPPETFILE_MONIKER}
                  .first
          line_number = loc.nil? ? 0 : loc.lineno - 1 # Line numbers from ruby are base 1
          # Note - Ruby doesn't give a character position so just highlight the entire line
          result << LanguageServer::Diagnostic.create('severity' => LanguageServer::DIAGNOSTICSEVERITY_ERROR,
                                                      'fromline' => line_number,
                                                      'toline'   => line_number,
                                                      'fromchar' => 0,
                                                      'tochar'   => max_line_length,
                                                      'source'   => 'Puppet',
                                                      'message'  => detail.to_s
          )

          puppetfile = nil
          raise
        end
        return result if puppetfile.nil?

        # We now have a parsable puppetfile

        # Check for duplicate module definitions
        dupes = puppetfile.modules
                  .group_by { |mod| mod.name }
                  .select { |_, v| v.size > 1 }
                  .map(&:first)
        dupes.each do |dupe_module_name|
          puppetfile.modules.select { |mod| mod.name == dupe_module_name}.each do |puppet_module|
            # Note - Ruby doesn't give a character position so just highlight the entire line
            result << LanguageServer::Diagnostic.create('severity' => LanguageServer::DIAGNOSTICSEVERITY_ERROR,
                                                        'fromline' => puppet_module.puppetfile_line_number,
                                                        'toline'   => puppet_module.puppetfile_line_number,
                                                        'fromchar' => 0,
                                                        'tochar'   => max_line_length,
                                                        'source'   => 'Puppet',
                                                        'message'  => "Duplicate module definition for '#{puppet_module.name}'"
            )
          end
        end

        # Check for missing metadata
        puppetfile.modules.each do |mod|
          metadata = mod.metadata
          # Basic Metadata Checks
          if metadata[:metadata_status].nil? || metadata[:metadata_status] == :unknown
            result << LanguageServer::Diagnostic.create('severity' => LanguageServer::DIAGNOSTICSEVERITY_WARNING,
                                                        'code'     => UNABLE_TO_VERIFY_ERROR_CODE,
                                                        'fromline' => mod.puppetfile_line_number,
                                                        'toline'   => mod.puppetfile_line_number,
                                                        'fromchar' => 0,
                                                        'tochar'   => max_line_length,
                                                        'source'   => 'Puppet',
                                                        'message'  => "Unable to verify module metadata for '#{mod.title}'"
            )
            next
          end
          if metadata[:metadata_status] == :missing
            result << LanguageServer::Diagnostic.create('severity' => LanguageServer::DIAGNOSTICSEVERITY_ERROR,
                                                        'code'     => NONEXIST_ERROR_CODE,
                                                        'fromline' => mod.puppetfile_line_number,
                                                        'toline'   => mod.puppetfile_line_number,
                                                        'fromchar' => 0,
                                                        'tochar'   => max_line_length,
                                                        'source'   => 'Puppet',
                                                        'message'  => "The module '#{mod.title}', or the specified version, does not exist"
            )
            next
          end
        end

        # Check for missing forge dependencies...
        failures = check_module_dependencies(puppetfile)
        result += failures unless failures.empty?

        result.compact
      end

      def self.check_module_dependencies(puppetfile)
        result = []

        puppetfile.modules.each do |mod|
          metadata = mod.metadata
          next unless metadata[:metadata_status] == :known

          # Check the actual dependencies
          metadata[:dependencies].each do |depends_on|
            dep_mod = ::R10K::Module.new(depends_on[:name], nil, nil)

            # Check if this module exists in the puppetfile
            dep_puppetfile_mod = puppetfile.modules.find { |i| i.name == dep_mod.name }
            if dep_puppetfile_mod.nil?
              result << LanguageServer::Diagnostic.create('severity' => LanguageServer::DIAGNOSTICSEVERITY_ERROR,
                #'code'     => UNMET_DEPENDENCY_ERROR_CODE,
                'fromline' => mod.puppetfile_line_number,
                'toline'   => mod.puppetfile_line_number,
                'fromchar' => 0,
                'tochar'   => max_line_length,
                'source'   => 'Puppet',
                'message'  => "The module '#{mod.title}' is missing dependant module '#{dep_mod.name}'"
              )
              next
            end

            # Recreate the module object if we know what version we should be checking
            unless dep_puppetfile_mod.version_from_puppetfile.nil?
              dep_mod = ::R10K::Module.new(depends_on[:name], nil, dep_puppetfile_mod.version_from_puppetfile)
            end

            unless depends_on[:version_requirement].nil?
              requirement = depends_on[:version_requirement]
              dep_mod_version = dep_mod.metadata[:version]
              if dep_mod_version.nil?
                result << LanguageServer::Diagnostic.create('severity' => LanguageServer::DIAGNOSTICSEVERITY_WARNING,
                                                            'code'     => UNABLE_TO_VERIFY_ERROR_CODE,
                                                            'fromline' => mod.puppetfile_line_number,
                                                            'toline'   => mod.puppetfile_line_number,
                                                            'fromchar' => 0,
                                                            'tochar'   => max_line_length,
                                                            'source'   => 'Puppet',
                                                            'message'  => "Unable to verify version requirement of '#{requirement}' for module '#{dep_mod.name}' in module '#{mod.title}'"
                )
                next
              end

              # Check the version range
              range = SemanticPuppet::VersionRange.parse(requirement)
              ver = SemanticPuppet::Version.parse(dep_mod_version)
              unless range.cover?(ver)
                result << LanguageServer::Diagnostic.create('severity' => LanguageServer::DIAGNOSTICSEVERITY_ERROR,
                                                            'code'     => UNMET_DEPENDENCY_ERROR_CODE,
                                                            'fromline' => dep_puppetfile_mod.puppetfile_line_number,
                                                            'toline'   => dep_puppetfile_mod.puppetfile_line_number,
                                                            'fromchar' => 0,
                                                            'tochar'   => max_line_length,
                                                            'source'   => 'Puppet',
                                                            'message'  => "Version '#{dep_mod_version}' of module '#{dep_mod.name}' does not satisfy requirement '#{requirement}' in module '#{mod.title}'"
                )
                next
              end
            end
          end
        end

        result
      end
    end
  end
end
