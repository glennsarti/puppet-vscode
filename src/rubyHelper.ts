import path = require('path');
import fs = require('fs');
import cp = require('child_process');
import { ILogger } from './logging';
import { IRubyConfiguration } from './interfaces';
import { PathResolver } from './configuration/pathResolver';
import { PuppetInstallType } from './settings';

export class RubyHelper {

  public static getRubyEnvFromConfiguration(
    rubyFile:string,
    rubyConfiguration: IRubyConfiguration,
    logger: ILogger
  ):{
    command: string;
    args: string[];
    options: cp.SpawnOptions;
  } {

    // setup defaults
    let spawn_options: cp.SpawnOptions = {};
        spawn_options.env              = this.shallowCloneObject(process.env);
        spawn_options.stdio            = 'pipe';

    switch (process.platform) {
      case 'win32':
        break;
      default:
        spawn_options.shell = true;
        break;
    }

    if (spawn_options.env.PATH === undefined) { spawn_options.env.PATH = ''; }
    if (spawn_options.env.RUBYLIB === undefined) { spawn_options.env.RUBYLIB = ''; }

    let command = '';
    let logPrefix: string='';
    switch(rubyConfiguration.puppetInstallType){
      case PuppetInstallType.pdk:
        logPrefix                        = '[getRubyEnvFromPDK] ';
        spawn_options.env.DEVKIT_BASEDIR = rubyConfiguration.puppetBaseDir;
        spawn_options.env.RUBY_DIR       = rubyConfiguration.pdkRubyDir;
        spawn_options.env.RUBYLIB        = new Array(rubyConfiguration.pdkRubyLib, spawn_options.env.RUBYLIB).join(PathResolver.pathEnvSeparator());
        spawn_options.env.PATH           = new Array(rubyConfiguration.pdkBinDir, rubyConfiguration.pdkRubyBinDir, spawn_options.env.PATH).join(PathResolver.pathEnvSeparator());
        spawn_options.env.RUBYOPT        = 'rubygems';
        spawn_options.env.GEM_HOME       = rubyConfiguration.pdkGemDir;
        spawn_options.env.GEM_PATH       = new Array(rubyConfiguration.pdkGemVerDir, rubyConfiguration.pdkGemDir, rubyConfiguration.pdkRubyVerDir).join(PathResolver.pathEnvSeparator());
        command                          = path.join(rubyConfiguration.pdkRubyDir, 'bin', 'ruby');
        break;
      case PuppetInstallType.agent:
        logPrefix                       = '[getRubyExecFromPuppetAgent] ';
        spawn_options.env.RUBY_DIR      = rubyConfiguration.rubydir;
        spawn_options.env.PATH          = new Array(rubyConfiguration.environmentPath, spawn_options.env.PATH).join(PathResolver.pathEnvSeparator());
        spawn_options.env.RUBYLIB       = new Array(rubyConfiguration.rubylib, spawn_options.env.RUBYLIB).join(PathResolver.pathEnvSeparator());
        spawn_options.env.RUBYOPT       = 'rubygems';
        spawn_options.env.SSL_CERT_FILE = rubyConfiguration.sslCertFile;
        spawn_options.env.SSL_CERT_DIR  = rubyConfiguration.sslCertDir;
        command                         = 'ruby';
        break;
    }

    logger.debug(logPrefix + 'Using environment variable RUBY_DIR='      + spawn_options.env.RUBY_DIR);
    logger.debug(logPrefix + 'Using environment variable PATH='          + spawn_options.env.PATH);
    logger.debug(logPrefix + 'Using environment variable RUBYLIB='       + spawn_options.env.RUBYLIB);
    logger.debug(logPrefix + 'Using environment variable RUBYOPT='       + spawn_options.env.RUBYOPT);
    logger.debug(logPrefix + 'Using environment variable SSL_CERT_FILE=' + spawn_options.env.SSL_CERT_FILE);
    logger.debug(logPrefix + 'Using environment variable SSL_CERT_DIR='  + spawn_options.env.SSL_CERT_DIR);
    logger.debug(logPrefix + 'Using environment variable GEM_PATH='      + spawn_options.env.GEM_PATH);
    logger.debug(logPrefix + 'Using environment variable GEM_HOME='      + spawn_options.env.GEM_HOME);

    let result = {
      command: command,
      args   : [rubyFile],
      options: spawn_options
    };

    return result;

  }

  private static shallowCloneObject(value:Object): Object {
    const clone: Object = {};
    for (const propertyName in value){
      if (value.hasOwnProperty(propertyName)){
        clone[propertyName] = value[propertyName];
      }
    }
    return clone;
  }
}
