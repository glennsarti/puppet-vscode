require 'r10k'

module R10K::Module

  # Register an module implementation for later generation
  def self.register(klass)
    @klasses ||= []
    @klasses << klass
  end

  #@ops_cache_update = Mutex.new
  @module_metadata_cache = {}

  def self.get_metadata_from_cache(cache_key)
    @module_metadata_cache[cache_key]
  end

  def self.set_metadata_in_cache(cache_key, metadata)
    @module_metadata_cache[cache_key] = metadata
  end

  # Look up the implementing class and instantiate an object
  #
  # This method takes the arguments for normal object generation and checks all
  # inheriting classes to see if they implement the behavior needed to create
  # the requested object. It selects the first class that can implement an object
  # with `name, args`, and generates an object of that class.
  #
  # @param [String] name The unique name of the module
  # @param [String] basedir The root to install the module in
  # @param [Object] args An arbitary value or set of values that specifies the implementation
  # @param [R10K::Environment] environment Optional environment that this module is a part of
  #
  # @return [Object < R10K::Module] A member of the implementing subclass
  def self.new(name, basedir, args, environment=nil)
    if implementation = @klasses.find { |klass| klass.implement?(name, args) }
      obj = implementation.new(name, basedir, args, environment)
      obj
    else
      raise _("Module %{name} with args %{args} doesn't have an implementation. (Are you using the right arguments?)") % {name: name, args: args.inspect}
    end
  end

  require 'r10k/module/base'
  require 'r10k/module/git'
  require 'r10k/module/svn'
  require 'r10k/module/local'
  require 'r10k/module/forge'
end
