require 'spec_helper'

def load_types_from_puppet
  native_types_hash = {}
  # This is an expensive call
  # From https://github.com/puppetlabs/puppet/blob/ebd96213cab43bb2a8071b7ac0206c3ed0be8e58/lib/puppet/metatype/manager.rb#L182-L189

  autoloader = Puppet::Util::Autoload.new(self, 'puppet/type')
  autoloader.files_to_load.each do |file|
    name = file.gsub(autoloader.path + '/', '')
    next if autoloader.loaded?(name)
    begin
      result = autoloader.load(name)
      PuppetLanguageServer.log_message(:error, "[PuppetHelper::_load_types] type #{file} did not load") unless result
    rescue StandardError => err
      PuppetLanguageServer.log_message(:error, "[PuppetHelper::_load_types] Error loading type #{file}: #{err}")
    end
  end

  Puppet::Type.eachtype do |type|
    next if type.name == :component
    next if type.name == :whit

    native_types_hash[type.name] = type
  end

  native_types_hash
end

describe 'Compare puppet ruby parser helper with actual ruby' do
  before(:all) {
    @native_types_hash = load_types_from_puppet

    # Ensure the types are loaded
    PuppetLanguageServer::PuppetHelper.load_types unless PuppetLanguageServer::PuppetHelper.types_loaded?
  }

  it 'should have the same type names' do
    pending('The Nagios types are just stubs and are too complex to process via AST/parsing alone')
    native_key_list = @native_types_hash.keys.map(&:to_s)
    expect(PuppetLanguageServer::PuppetHelper.type_names).to match_array(native_key_list)
  end

  it 'should have the same type names except for nagios' do
    native_key_list = @native_types_hash.keys.map(&:to_s)
    native_key_list.reject! { |t| t =~ /nagios/ }
    expect(PuppetLanguageServer::PuppetHelper.type_names).to match_array(native_key_list)
  end

  #load_types_from_puppet.select { |t,v| t.to_s == 'file'}.each do |puppet_type_name, puppet_type_value|
  load_types_from_puppet.select { |t,v| t.to_s !~ /nagios/}.each do |puppet_type_name, puppet_type_value|

    describe "The puppet type #{puppet_type_name}" do
      let(:subject) { PuppetLanguageServer::PuppetHelper.get_type(puppet_type_name) }
      let(:native) { @native_types_hash[puppet_type_name] }

      it "should have the same documentation" do
        expect(subject.doc).to eq(native.doc)
      end

      it "should have the same list of attributes" do
        require 'pry'; binding.pry
        expect(subject.allattrs).to match_array(native.allattrs)
      end
    end

  end

end
