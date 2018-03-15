module PuppetLanguageServer
  module PuppetHelper
    class PersistentFileCache
      attr_reader :cache_dir

      def initialize(_inmemory_cache, _options = {})
        require 'digest/md5'
        require 'json'

        @cache_dir = File.join(ENV['TMP'], 'puppet-vscode-cache')
        Dir.mkdir(@cache_dir) unless Dir.exist?(@cache_dir)
      end

      def load(absolute_path, file_key)
        cache_file = File.join(cache_dir, cache_filename(file_key))

        content = read_cache_file(cache_file)
        return nil if content.nil?

        json_obj = JSON.parse(content)

        # Check that this is from the same language server version
        unless json_obj.nil? || json_obj['metadata']['version'] == PuppetVSCode.version
          PuppetLanguageServer.log_message(:debug, "[PuppetHelperFileCache::load_from_persistent_cache] Error loading #{absolute_path}: Expected language server version #{PuppetVSCode.version} but found #{json_obj['metadata']['version']}")
          json_obj = nil
        end
        # Check that the source file md5 hash matches
        content_hash = md5_hash(absolute_path) unless json_obj.nil?
        unless json_obj.nil? || json_obj['metadata']['content_md5'] != content_hash
          PuppetLanguageServer.log_message(:debug, "[PuppetHelperFileCache::load_from_persistent_cache] Error loading #{absolute_path}: Expected content_md5 of #{content_hash} but found #{json_obj['metadata']['content_md5']}")
          json_obj = nil
        end

        json_obj
      rescue RuntimeError => detail
        PuppetLanguageServer.log_message(:debug, "[PuppetHelperFileCache::load_from_persistent_cache] Error loading #{absolute_path}: #{detail}")
        raise
      end

      def save!(absolute_path, content)
        file_key = canonical_path(absolute_path)
        cache_file = File.join(cache_dir, cache_filename(file_key))

        # Inject metadata
        content['metadata']['version'] = PuppetVSCode.version
        content['metadata']['content_md5'] = md5_hash(absolute_path)

        save_cache_file(cache_file, content.to_json)
      end

      private

      def save_cache_file(filepath, content)
        File.open(filepath, 'wb') { |file| file.write(content) }
        true
      end

      def read_cache_file(filepath)
        return nil unless File.exist?(filepath)

        File.open(filepath, 'rb') { |file| file.read }
      end

      def cache_filename(absolute_path)
        Digest::MD5.hexdigest(canonical_path(absolute_path)) + '.txt'
      end

      def md5_hash(filepath)
        Digest::MD5.hexdigest(read_cache_file(filepath))
      end

      def canonical_path(filepath)
        # Strictly speaking some file systems are case sensitive but ruby/puppet throws a fit
        # with naming if you do
        file_key = filepath.downcase

        file_key
      end
    end
  end
end
