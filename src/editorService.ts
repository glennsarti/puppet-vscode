import net = require('net');
import vscode = require('vscode');
import cp = require('child_process');
import { ILogger } from '../src/logging';
import { ConnectionStatus, IRubyConfiguration } from './interfaces';
import { LanguageClient, LanguageClientOptions, ServerOptions } from 'vscode-languageclient';
import { PuppetStatusBar } from './PuppetStatusBar';
import { ISettings, ServiceProtocol } from './settings';
//import { PuppetLanguageClient } from './PuppetLanguageClient';
import { RubyConfiguration } from './configuration';
import { RubyHelper } from './rubyHelper';

// import { IConnectionConfiguration, ConnectionStatus, ConnectionType, ProtocolType } from './interfaces'
// import { LanguageClient, LanguageClientOptions, ServerOptions } from 'vscode-languageclient';
// import { RubyHelper } from './rubyHelper';
// import { PuppetStatusBar } from './PuppetStatusBar';
// import { PuppetLanguageClient } from './PuppetLanguageClient';
// import { ConnectionConfiguration } from './configuration';

const langID = 'puppet'; // don't change this
const documentSelector = { scheme: 'file', language: langID };

export enum ConnectionType {
  Unknown,
  Local,
  Remote
}

// TODO: Do we need this interface?
export interface IxxxEditorServiceConnection {
  status: ConnectionStatus;
  languageClient: LanguageClient;
  showLogger(): void;
  restartConnection(connectionConfig?: IConnectionConfiguration): void;
}

export class EditorServiceConnection implements IxxxEditorServiceConnection {
  private connectionStatus: ConnectionStatus;
  private statusBarItem: PuppetStatusBar;
  private logger: ILogger;
  private extensionContext: vscode.ExtensionContext;
  //private settings: ISettings;
  private languageServerClient: LanguageClient;
  private languageServerProcess: cp.ChildProcess;
  private puppetLanguageClient: PuppetLanguageClient;

  constructor(
    context: vscode.ExtensionContext,
    logger: ILogger,
    statusBar: PuppetStatusBar //,
    //settings: ISettings
  ) {
    this.logger = logger;
    this.extensionContext = context;
    this.connectionStatus = ConnectionStatus.NotStarted;
    this.statusBarItem = statusBar;
    //this.settings = settings;
    //this.connectionConfiguration = connectionConfiguration;
  }

  public get status(): ConnectionStatus {
    return this.connectionStatus;
  }

  public set status(status: ConnectionStatus) {
    this.connectionStatus = status;
  }

  public get languageClient(): LanguageClient {
    return this.languageServerClient;
  }

  private connectionType(settings: ISettings): ConnectionType {
    // The STDIO protocol is always local
    if (settings.editorService.protocol === ServiceProtocol.stdio) { return ConnectionType.Local; }
    if (settings.editorService.protocol === ServiceProtocol.tcp) {
      if (settings.editorService.tcp.address === '127.0.0.1' || settings.editorService.tcp.address === 'localhost' || settings.editorService.tcp.address === '') {
        return ConnectionType.Local;
      } else {
        return ConnectionType.Remote;
      }
    }
    // If we don't recognise the protocol just set it to local
    return ConnectionType.Local;
  }

  public start(settings: ISettings) {
    // Setup the configuration
    //this.settings = settings;
    const rubyconfig: IRubyConfiguration = new RubyConfiguration(settings);

    this.setConnectionStatus('Starting Puppet...', ConnectionStatus.Starting);

    if (this.connectionType(settings) === ConnectionType.Local) {
      this.createLanguageServerProcess(
        this.extensionContext.asAbsolutePath(rubyconfig.languageServerPath),
        settings,
        this.onLanguageServerStart.bind(this)
      );
    } else {
      this.languageServerClient = this.createLanguageClient();
      this.extensionContext.subscriptions.push(this.languageServerClient.start());
      this.logStart();
    }
  }

  public stop() {
    this.logger.debug('Stopping...');

    this.connectionStatus = ConnectionStatus.Stopping;

    // Close the language server client
    if (this.languageServerClient !== undefined) {
      this.languageServerClient.stop();
    }

    // The language server process we spawn will close once the
    // client disconnects.  No need to forcibly kill the process here. Also the language
    // client will try and send a shutdown event, which will throw errors if the language
    // client can no longer transmit the message.

    this.connectionStatus = ConnectionStatus.NotStarted;

    this.logger.debug('Stopped');
  }

  public dispose(): void {
    this.logger.debug('Disposing...');
    // Stop the current session
    this.stop();

    // Dispose of any subscriptions
    this.extensionContext.subscriptions.forEach(item => {
      item.dispose();
    });
  }

  public showLogger() {
    this.logger.show();
  }

  private logStart() {
    this.logger.debug('Congratulations, your extension "vscode-puppet" is now active!');
  }

  private onLanguageServerStart(settings: ISettings, proc: cp.ChildProcess) {
    this.logger.debug('LanguageServer Process Started: ' + proc.pid);
    this.languageServerProcess = proc;
    if (this.languageServerProcess === undefined) {
      if (this.connectionStatus === ConnectionStatus.Failed) {
        // We've already handled this state.  Just return
        return;
      }
      throw new Error('Unable to start the Language Server Process');
    }

    switch (settings.editorService.protocol) {
      case ServiceProtocol.tcp:
        this.languageServerProcess.stdout.on('data', data => {
          this.logger.debug('OUTPUT: ' + data.toString());

          // If the language client isn't already running and it's sent the trigger text, start up a client
          if (this.languageServerClient === undefined && /LANGUAGE SERVER RUNNING/.test(data.toString())) {
            if (settings.editorService.tcp.port) {
              this.languageServerClient = this.createLanguageClient();
            } else {
              var p = data.toString().match(/LANGUAGE SERVER RUNNING.*:(\d+)/);
              // TODO : can we use something other that the config object to store this?
              this.connectionConfiguration.port = +p[1];
              this.languageServerClient = this.createLanguageClient();
            }
            this.extensionContext.subscriptions.push(this.languageServerClient.start());
          }
        });
        break;
      // The default is to use STDIO
      default:
        this.logger.debug('Starting STDIO client: ');
        this.languageServerClient = this.createLanguageClient();
        this.extensionContext.subscriptions.push(this.languageServerClient.start());
        break;
    }

    this.languageServerProcess.on('close', exitCode => {
      this.logger.debug('SERVER terminated with exit code: ' + exitCode);
    });

    this.logStart();
  }

  public startLanguageServerProcess(cmd: string, args: Array<string>, options: cp.SpawnOptions, settings:ISettings, callback: Function) {
    let logPrefix: string = '[startLanguageServerProcess] ';
    const rubyconfig: IRubyConfiguration = new RubyConfiguration(settings);

    var parsed = rubyconfig.languageServerCommandLine;
    args = args.concat(parsed);

    this.logger.debug(logPrefix + 'Starting the language server with ' + cmd + ' ' + args.join(' '));
    var proc = cp.spawn(cmd, args, options);
    this.logger.debug(logPrefix + 'Language server PID:' + proc.pid);

    callback(proc);
  }

  private createLanguageServerProcess(serverExe: string, settings:ISettings, callback: Function) {
    let logPrefix: string = '[createLanguageServerProcess] ';
    this.logger.debug(logPrefix + 'Language server found at: ' + serverExe);
    const rubyconfig: IRubyConfiguration = new RubyConfiguration(settings);

    let localServer: {
      command: string;
      args: string[];
      options: cp.SpawnOptions;
    } = RubyHelper.getRubyEnvFromConfiguration(serverExe, rubyconfig, this.logger);

    if (settings.editorService.protocol === ServiceProtocol.tcp){
      // TODO: Wha?
      if (settings.editorService.tcp.port) {
        this.logger.debug(logPrefix + 'Selected port for local language server: ' + settings.editorService.tcp.port);
      }
    } else {
      this.logger.debug(logPrefix + 'STDIO Server process starting');
    }
    this.startLanguageServerProcess(localServer.command, localServer.args, localServer.options, settings, callback);
  }

  private STDIOServerOptions(serverProcess: cp.ChildProcess, logger:ILogger): ServerOptions {
    let serverOptions: ServerOptions = function() {
      return new Promise((resolve, reject) => {
        logger.debug(`[Puppet Lang Server Client] stdio connected`);
        resolve(serverProcess);
      });
    };
    return serverOptions;
  }

  private createTCPServerOptions(
    address: string,
    port: number,
    logger: ILogger
  ): ServerOptions {
    let serverOptions: ServerOptions = function() {
      return new Promise((resolve, reject) => {
        const retries = 5;
        var attempt = 0;
        var client = new net.Socket();

        const rconnect = () => { client.connect(port, address) };

        client.connect(port, address, function() {
          logger.debug(`[Puppet Lang Server Client] tcp connected`);
          resolve({ reader: client, writer: client });
        });

        client.on('error', function(err) {
          
          if(attempt === retries){
            logger.error(`[Puppet Lang Server Client] ` + `Could not start language client: ${err.message}`);
            this.setConnectionStatus(
              `Could not start language client: ${err.message}`,
              ConnectionStatus.Failed
            );

            vscode.window.showErrorMessage(
              `Could not start language client: ${err.message}. Please click 'Troubleshooting Information' for resolution steps`,
              { modal: false },
              { title: 'Troubleshooting Information' }
            ).then((item)=>{
                if (item === undefined){
                  return;
                }
                if(item.title === 'Troubleshooting Information'){
                  vscode.commands.executeCommand(
                    'vscode.open',
                    vscode.Uri.parse('https://github.com/lingua-pupuli/puppet-vscode#experience-a-problem')
                  );
                }
              }
            );

            return null;
          }else{
            attempt = attempt + 1;
            var message = `Timed out connecting to language server. Is the server running at ${address}:${port} ? Will wait timeout value before trying again`;
            switch(err['code']){
              case 'ETIMEDOUT':
                message = `Timed out connecting to language server. Is the server running at ${address}:${port} ? Will wait timeout value before trying again`;
                break;
              case 'ECONNREFUSED':
                message = `Connect refused to language server. Is the server running at ${address}:${port} ? Will wait for 5 seconds before trying again`;
                break;
              default:
                message = `Connect refused to language server. Is the server running at ${address}:${port} ? Will wait for 5 seconds before trying again`;
                break;
            }
            vscode.window.showWarningMessage(message);
            logger.warning(message);
            setTimeout(rconnect, 5000);
          }

        });

      });
    };
    return serverOptions;
  }

  private createLanguageClient(settings: ISettings): LanguageClient {
    this.logger.debug('Configuring language server options');

    let serverOptions: ServerOptions;
    switch (settings.editorService.protocol) {
      case ServiceProtocol.tcp:
        serverOptions =  this.createTCPServerOptions(
          settings.editorService.tcp.address,
          settings.editorService.tcp.port,
          this.logger
        );
        this.logger.debug(
          `Starting language server client (host ${settings.editorService.tcp.address} port ${
            settings.editorService.tcp.port
          })`
        );
        break;
      // Default is STDIO
      default:
        this.logger.debug(
          `Starting language server client (stdio)`
        );
          serverOptions = this.STDIOServerOptions(this.languageServerProcess, this.logger);
          break;
      }

    this.logger.debug('Configuring language server client options');
    let clientOptions: LanguageClientOptions = {
      documentSelector: [documentSelector]
    };

    this.puppetLanguageClient = new EditorServiceClient(
      settings.editorService.tcp.address,
      settings.editorService.tcp.port,
      this,
      serverOptions,
      clientOptions,
      this.statusBarItem,
      this.logger
    );

    return this.puppetLanguageClient.languageServerClient;
  }

  public restartConnection(connectionConfig?: IConnectionConfiguration) {
    if (connectionConfig === undefined) {
      connectionConfig = new ConnectionConfiguration();
    }
    this.stop();
    this.start(connectionConfig);
  }

  private setConnectionStatus(statusText: string, status: ConnectionStatus): void {
    this.connectionStatus = status;
    this.statusBarItem.setConnectionStatus(statusText, status);
  }

  private setSessionFailure(message: string, ...additionalMessages: string[]) {
    this.setConnectionStatus('Starting Error', ConnectionStatus.Failed);
  }
}

// import { ConnectionStatus } from "./interfaces";
// import { LanguageClient } from "vscode-languageclient/lib/main";
// import { PuppetStatusBar } from "./PuppetStatusBar";
// import { ILogger } from "./logging";
// import { ServerOptions, LanguageClientOptions } from "vscode-languageclient/lib/client";
// import { PuppetVersionDetails, PuppetVersionRequest } from "./messages";
// import { ConnectionManager } from "./connection";

export class EditorServiceClient {
  connectionStatus: ConnectionStatus;
  connectionManager:ConnectionManager;
  clientOptions: LanguageClientOptions;
  serverOptions: ServerOptions;
  port: number;
  host: string;
  languageServerClient: LanguageClient;
  //statusBarItem: PuppetStatusBar;
  logger:ILogger;

  constructor(
    host: string,
    port: number,
    connectionManager:ConnectionManager,
    serverOptions: ServerOptions,
    clientOptions: LanguageClientOptions,
    statusBarItem: PuppetStatusBar,
    logger:ILogger
  ) {
    this.host = host;
    this.port = port;
    this.connectionManager = connectionManager;
    this.serverOptions = serverOptions;
    this.clientOptions = clientOptions;
    this.connectionStatus = ConnectionStatus.NotStarted;
    //this.statusBarItem = statusBarItem;
    this.logger = logger;

    // TODO: Need a better title than this!
    var title = `tcp lang server (host ${this.host} port ${this.port})`;

    this.languageServerClient = new LanguageClient(title, this.serverOptions, this.clientOptions);
    this.languageServerClient.onReady().then(
      () => {
        logger.debug('Language server client started, setting puppet version');
        this.setConnectionStatus('Loading Puppet', ConnectionStatus.Starting);
        this.queryLanguageServerStatus();
      },
      reason => {
        this.setConnectionStatus('Starting Error', ConnectionStatus.Failed);
      }
    );

  }

  public setConnectionStatus(statusText: string, status: ConnectionStatus): void {
    this.connectionStatus = status;
    this.connectionManager.status = status;
    //this.statusBarItem.setConnectionStatus(statusText, status);
  }

  private queryLanguageServerStatus() {

    return new Promise((resolve, reject) => {
      let count = 0;
      let lastVersionResponse: PuppetVersionDetails;
      let handle = setInterval(() => {
        count++;

        // After 30 seonds timeout the progress
        if (count >= 30 || this.languageServerClient === undefined) {
          clearInterval(handle);
          this.setConnectionStatus(lastVersionResponse.puppetVersion, ConnectionStatus.Running);
          resolve();
          return;
        }

        this.languageServerClient.sendRequest(PuppetVersionRequest.type).then(versionDetails => {
          lastVersionResponse = versionDetails;
          if (
            versionDetails.factsLoaded &&
            versionDetails.functionsLoaded &&
            versionDetails.typesLoaded &&
            versionDetails.classesLoaded
          ) {
            clearInterval(handle);
            this.setConnectionStatus(lastVersionResponse.puppetVersion, ConnectionStatus.Running);
            resolve();
          } else {
            let progress = 0;

            if (versionDetails.factsLoaded) { progress++; }
            if (versionDetails.functionsLoaded) { progress++; }
            if (versionDetails.typesLoaded) { progress++; }
            if (versionDetails.classesLoaded) { progress++; }

            progress = Math.round(progress / 4.0 * 100);

            this.setConnectionStatus('Loading Puppet (' + progress.toString() + '%)', ConnectionStatus.Starting);
          }
        });

      }, 1000);

    });
  }
}
