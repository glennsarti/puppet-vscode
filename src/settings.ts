'use strict';

import vscode = require("vscode");
import { LogLevel } from './logging'; // TODO: Should this be in settings or logging?  Seems like a setting personally...

export enum InstallType {
  pdk = "pdk",
  agent = "agent"
}

export enum ServiceProtocol {
  stdio = "stdio",
  tcp = "tcp"
}

export interface IEditorServiceDockerSettings {
  // Future Use
}

export interface IEditorServiceTCPSettings {
  address?: string;
  port?: number;
}

export interface IEditorServiceSettings {
  debugFilePath?: string;
  docker?: IEditorServiceDockerSettings;
  enable?: boolean;
  featureflags?: string[];
  loglevel?: LogLevel;
  protocol?: string;
  tcp?: IEditorServiceTCPSettings;
  timeout?: number;
}

export interface IFormatSettings {
  enable?: boolean;
}

export interface ILintSettings {
  // Future Use
  enable?: boolean; // Future Use: Puppet Editor Services doesn't implement this yet.
}

export interface IPDKSettings {
  // Future Use
}

export interface ISettings {
  editorService?: IEditorServiceSettings;
  format?: IFormatSettings;
  installDirectory?: string;
  installType?: string;
  lint?: ILintSettings;
  pdk?: IPDKSettings;
}

const workspaceSectionName = "puppet";

export function fromWorkspace(): ISettings {
  // Default settings
  const defaultEditorServiceSettings: IEditorServiceSettings = {
    enable: true,
    featureflags: [],
    loglevel: LogLevel.Normal,
    protocol: ServiceProtocol.stdio,
    timeout: 10,
  };

  const defaultFormatSettings: IFormatSettings = {
    enable: true,
  };

  const defaultLintSettings: ILintSettings = {
    enable: true,
  };

  const defaultPDKSettings: IPDKSettings = {};

  const workspaceConfig: vscode.WorkspaceConfiguration = vscode.workspace.getConfiguration(workspaceSectionName);

  return {
    editorService: workspaceConfig.get<IEditorServiceSettings>("editorService", defaultEditorServiceSettings),
    format: workspaceConfig.get<IFormatSettings>("format", defaultFormatSettings),
    installDirectory: workspaceConfig.get<string>("installDirectory", undefined),
    installType: workspaceConfig.get<InstallType>("installType", InstallType.agent),
    lint: workspaceConfig.get<ILintSettings>("lint", defaultLintSettings),
    pdk: workspaceConfig.get<IPDKSettings>("pdk", defaultPDKSettings)
  };
}

/**
 * Retrieves the list of "legacy" or deprecated setting names and their values
 */
export function legacySettings(): Map<string, Object> {
  const workspaceConfig: vscode.WorkspaceConfiguration = vscode.workspace.getConfiguration(workspaceSectionName);

  let settings: Map<string, Object> = new Map<string, Object>();
  let value: Object = undefined;

  // puppet.languageclient.minimumUserLogLevel
  value = workspaceConfig['languageclient']['minimumUserLogLevel'];
  if (value !== undefined) { settings.set("puppet.languageclient.minimumUserLogLevel", value); }

  // puppet.languageclient.protocol
  value = workspaceConfig['languageclient']['protocol'];
  if (value !== undefined) { settings.set("puppet.languageclient.protocol", value); }

  // puppet.languageserver.address
  value = workspaceConfig['languageserver']['address'];
  if (value !== undefined) { settings.set("puppet.languageserver.address", value); }

  // puppet.languageserver.debugFilePath
  value = workspaceConfig['languageserver']['debugFilePath'];
  if (value !== undefined) { settings.set("puppet.languageserver.debugFilePath", value); }

  // puppet.languageserver.filecache.enable
  value = workspaceConfig['languageserver']['filecache']['enable'];
  if (value !== undefined) { settings.set("puppet.languageserver.filecache.enable", value); }

  // puppet.languageserver.port
  value = workspaceConfig['languageserver']['port'];
  if (value !== undefined) { settings.set("puppet.languageserver.port", value); }

  // puppet.languageserver.timeout
  value = workspaceConfig['languageserver']['timeout'];
  if (value !== undefined) { settings.set("puppet.languageserver.timeout", value); }

  return settings;
}

/**
 * Retrieves the normal workspace settings, but also retrieves the old/deprecated setting
 * names and translates them to the normal workspace name
 */
export function fromLegacyWorkspace(): ISettings {
  // Retrieve the current settings
  let settings: ISettings = fromWorkspace();
  if (settings.editorService === undefined) { settings.editorService = {}; }
  if (settings.editorService.featureflags === undefined) { settings.editorService.featureflags = []; }
  if (settings.editorService.tcp === undefined) { settings.editorService.tcp = {}; }

  // Retrieve the legacy settings
  const oldSettings: Map<string, Object> = legacySettings();

  // Translate the legacy settings into the new setting names
  for (const [settingName, value] of oldSettings) {
    switch (settingName) {

      case "puppet.languageclient.minimumUserLogLevel": // --> puppet.editorService.loglevel
        settings.editorService.loglevel = <LogLevel>value;
        break;

      case "puppet.languageclient.protocol": // --> puppet.editorService.protocol
        settings.editorService.protocol = <string>value;
        break;

      case "puppet.languageserver.address": // --> puppet.editorService.tcp.address
        settings.editorService.tcp.address = <string>value;
        break;

      case "puppet.languageserver.debugFilePath": // --> puppet.editorService.debugFilePath
        settings.editorService.debugFilePath = <string>value;
        break;

      case "puppet.languageserver.filecache.enable": // --> puppet.editorService.featureflags['filecache']
        if (value === true) { settings.editorService.featureflags.push("filecache"); }
        break;

      case "puppet.languageserver.port": // --> puppet.editorService.tcp.port
        settings.editorService.tcp.port = <number>value;
        break;

      case "puppet.languageserver.timeout": // --> puppet.editorService.timeout
        settings.editorService.timeout = <number>value;
        break;
    }
  }

  return settings;
}
