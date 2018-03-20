'use strict';

import * as vscode from 'vscode';
import * as path from 'path';
import { PuppetStringsRequest } from '../messages';
import { ConnectionStatus } from '../interfaces';
import { IConnectionManager } from '../connection';
import { reporter } from '../telemetry/telemetry';
import * as messages from '../messages';

import { MarkdownEngine } from '../markdown/markdownEngine';
import { IMarkdownDocumentRenderer } from '../markdown/markdownExtensions';
import { ContentSecurityPolicyArbiter, MarkdownPreviewSecurityLevel } from '../markdown/security';

const previewStrings = {
  cspAlertMessageText: 'Some content has been disabled in this document',
  cspAlertMessageTitle: 'Potentially unsafe or insecure content has been disabled in the markdown preview. Change the Markdown preview security setting to allow insecure content or enable scripts',
  cspAlertMessageLabel: 'Content Disabled Security Warning'
};

export function getPuppetStringsUri(langID: string, uri: vscode.Uri) {
  if (uri.scheme === langID) {
    return uri;
  }

  return uri.with({
    scheme: langID,
    path: uri.fsPath + '.rendered',
    query: uri.toString()
  });
}

class MarkdownPreviewConfig {
  public static getConfigForResource(resource: vscode.Uri) {
    return new MarkdownPreviewConfig(resource);
  }

  public readonly scrollBeyondLastLine: boolean;
  public readonly wordWrap: boolean;
  public readonly previewFrontMatter: string;
  public readonly lineBreaks: boolean;
  public readonly doubleClickToSwitchToEditor: boolean;
  public readonly scrollEditorWithPreview: boolean;
  public readonly scrollPreviewWithEditorSelection: boolean;
  public readonly markEditorSelection: boolean;

  public readonly lineHeight: number;
  public readonly fontSize: number;
  public readonly fontFamily: string | undefined;
  public readonly styles: string[];

  private constructor(resource: vscode.Uri) {
    const editorConfig = vscode.workspace.getConfiguration('editor', resource);
    const markdownConfig = vscode.workspace.getConfiguration('markdown', resource);
    const markdownEditorConfig = vscode.workspace.getConfiguration('[markdown]');

    this.scrollBeyondLastLine = editorConfig.get<boolean>('scrollBeyondLastLine', false);

    this.wordWrap = editorConfig.get<string>('wordWrap', 'off') !== 'off';
    if (markdownEditorConfig && markdownEditorConfig['editor.wordWrap']) {
      this.wordWrap = markdownEditorConfig['editor.wordWrap'] !== 'off';
    }

    this.previewFrontMatter = markdownConfig.get<string>('previewFrontMatter', 'hide');
    this.scrollPreviewWithEditorSelection = !!markdownConfig.get<boolean>('preview.scrollPreviewWithEditorSelection', true);
    this.scrollEditorWithPreview = !!markdownConfig.get<boolean>('preview.scrollEditorWithPreview', true);
    this.lineBreaks = !!markdownConfig.get<boolean>('preview.breaks', false);
    this.doubleClickToSwitchToEditor = !!markdownConfig.get<boolean>('preview.doubleClickToSwitchToEditor', true);
    this.markEditorSelection = !!markdownConfig.get<boolean>('preview.markEditorSelection', true);

    this.fontFamily = markdownConfig.get<string | undefined>('preview.fontFamily', undefined);
    this.fontSize = Math.max(8, +markdownConfig.get<number>('preview.fontSize', NaN));
    this.lineHeight = Math.max(0.6, +markdownConfig.get<number>('preview.lineHeight', NaN));

    this.styles = markdownConfig.get<string[]>('styles', []);
  }

  public isEqualTo(otherConfig: MarkdownPreviewConfig) {
    for (let key in this) {
      if (this.hasOwnProperty(key) && key !== 'styles') {
        if (this[key] !== otherConfig[key]) {
          return false;
        }
      }
    }

    // Check styles
    if (this.styles.length !== otherConfig.styles.length) {
      return false;
    }
    for (let i = 0; i < this.styles.length; ++i) {
      if (this.styles[i] !== otherConfig.styles[i]) {
        return false;
      }
    }

    return true;
  }

  [key: string]: any;
}

class PreviewConfigManager {
  private previewConfigurationsForWorkspaces = new Map<string, MarkdownPreviewConfig>();

  public loadAndCacheConfiguration(
    resource: vscode.Uri
  ) {
    const config = MarkdownPreviewConfig.getConfigForResource(resource);
    this.previewConfigurationsForWorkspaces.set(this.getKey(resource), config);
    return config;
  }

  public shouldUpdateConfiguration(
    resource: vscode.Uri
  ): boolean {
    const key = this.getKey(resource);
    const currentConfig = this.previewConfigurationsForWorkspaces.get(key);
    const newConfig = MarkdownPreviewConfig.getConfigForResource(resource);
    return (!currentConfig || !currentConfig.isEqualTo(newConfig));
  }

  private getKey(
    resource: vscode.Uri
  ): string {
    const folder = vscode.workspace.getWorkspaceFolder(resource);
    if (!folder) {
      return '';
    }
    return folder.uri.toString();
  }
}

export class PuppetStringsContentProvider implements vscode.TextDocumentContentProvider, IMarkdownDocumentRenderer {
  private _onDidChange = new vscode.EventEmitter<vscode.Uri>();
  private _waiting: boolean = false;
  private _connectionManager: IConnectionManager = undefined;
  private _shownLanguageServerNotAvailable = false;
  private _previewConfigurations = new PreviewConfigManager();

  private _extraStyles: Array<vscode.Uri> = [];
  private _extraScripts: Array<vscode.Uri> = [];

  constructor(
    private context: vscode.ExtensionContext,
    private connMgr: IConnectionManager,
    private engine: MarkdownEngine,
    private cspArbiter: ContentSecurityPolicyArbiter
  ) {
    this._connectionManager = connMgr;
  }

  public addScript(resource: vscode.Uri): void {
    this._extraScripts.push(resource);
  }

  public addStyle(resource: vscode.Uri): void {
    this._extraStyles.push(resource);
  }

  private getMediaPath(mediaFile: string): string {
    return vscode.Uri.file(this.context.asAbsolutePath(path.join('src','markdown','media', mediaFile))).toString();
  }

  private fixHref(resource: vscode.Uri, href: string): string {
    if (!href) {
      return href;
    }

    // Use href if it is already an URL
    const hrefUri = vscode.Uri.parse(href);
    if (['file', 'http', 'https'].indexOf(hrefUri.scheme) >= 0) {
      return hrefUri.toString();
    }

    // Use href as file URI if it is absolute
    if (path.isAbsolute(href)) {
      return vscode.Uri.file(href).toString();
    }

    // use a workspace relative path if there is a workspace
    let root = vscode.workspace.getWorkspaceFolder(resource);
    if (root) {
      return vscode.Uri.file(path.join(root.uri.fsPath, href)).toString();
    }

    // otherwise look relative to the markdown file
    return vscode.Uri.file(path.join(path.dirname(resource.fsPath), href)).toString();
  }

  private computeCustomStyleSheetIncludes(resource: vscode.Uri, config: MarkdownPreviewConfig): string {
    if (config.styles && Array.isArray(config.styles)) {
      return config.styles.map(style => {
        return `<link rel="stylesheet" class="code-user-style" data-source="${style.replace(/"/g, '&quot;')}" href="${this.fixHref(resource, style)}" type="text/css" media="screen">`;
      }).join('\n');
    }
    return '';
  }

  private getSettingsOverrideStyles(nonce: string, config: MarkdownPreviewConfig): string {
    return `<style nonce="${nonce}">
      body {
        ${config.fontFamily ? `font-family: ${config.fontFamily};` : ''}
        ${isNaN(config.fontSize) ? '' : `font-size: ${config.fontSize}px;`}
        ${isNaN(config.lineHeight) ? '' : `line-height: ${config.lineHeight};`}
      }
    </style>`;
  }

  private getStyles(resource: vscode.Uri, nonce: string, config: MarkdownPreviewConfig): string {
    const baseStyles = [
      this.getMediaPath('markdown.css'),
      this.getMediaPath('tomorrow.css')
    ].concat(this._extraStyles.map(resource => resource.toString()));

    return `${baseStyles.map(href => `<link rel="stylesheet" type="text/css" href="${href}">`).join('\n')}
      ${this.getSettingsOverrideStyles(nonce, config)}
      ${this.computeCustomStyleSheetIncludes(resource, config)}`;
  }

  private getScripts(nonce: string): string {
    const scripts = [this.getMediaPath('main.js')].concat(this._extraScripts.map(resource => resource.toString()));
    return scripts
      .map(source => `<script async src="${source}" nonce="${nonce}" charset="UTF-8"></script>`)
      .join('\n');
  }

  public async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
    const sourceUri = vscode.Uri.parse(uri.query);
    var thisProvider = this

      if (thisProvider._connectionManager.status != ConnectionStatus.Running ) {
        if (!thisProvider._shownLanguageServerNotAvailable) {
          vscode.window.showInformationMessage("Puppet Strings Preview is not available as the Language Server is not ready");
          thisProvider._shownLanguageServerNotAvailable = true;
        }
        return "Puppet Strings Preview is not available as the Language Server is not ready";
      }

      const document = await vscode.workspace.openTextDocument(sourceUri);
      var markdownContent = "There is no module documentation"

      var langServerResponse = await thisProvider._connectionManager.languageClient.sendRequest(PuppetStringsRequest.type, sourceUri);
      if (langServerResponse.error != null) {
        markdownContent = langServerResponse.error
      } else {
        markdownContent = langServerResponse.data
      }

      const config = this._previewConfigurations.loadAndCacheConfiguration(sourceUri);
      const initialData = {
        previewUri: uri.toString(),
        source: sourceUri.toString(),
        scrollPreviewWithEditorSelection: false, //config.scrollPreviewWithEditorSelection,
        scrollEditorWithPreview: false, //config.scrollEditorWithPreview,
        doubleClickToSwitchToEditor: config.doubleClickToSwitchToEditor,
        disableSecurityWarnings: this.cspArbiter.shouldDisableSecurityWarnings()
      };

      // Content Security Policy
      const nonce = new Date().getTime() + '' + new Date().getMilliseconds();
      const csp = this.getCspForResource(sourceUri, nonce);

      let body = await this.engine.render(sourceUri, config.previewFrontMatter === 'hide', markdownContent)
      return `<!DOCTYPE html>
        <html>
        <head>
          <meta http-equiv="Content-type" content="text/html;charset=UTF-8">
          ${csp}
          <meta id="vscode-markdown-preview-data" data-settings="${JSON.stringify(initialData).replace(/"/g, '&quot;')}" data-strings="${JSON.stringify(previewStrings).replace(/"/g, '&quot;')}">
          <script src="${this.getMediaPath('csp.js')}" nonce="${nonce}"></script>
          <script src="${this.getMediaPath('loading.js')}" nonce="${nonce}"></script>
          ${this.getStyles(sourceUri, nonce, config)}
          <base href="${document.uri.toString(true)}">
        </head>
        <body class="vscode-body ${config.scrollBeyondLastLine ? 'scrollBeyondLastLine' : ''} ${config.wordWrap ? 'wordWrap' : ''} ${config.markEditorSelection ? 'showEditorSelection' : ''}">
          ${body}
          <div class="code-line" data-line="${document.lineCount}"></div>
          ${this.getScripts(nonce)}
        </body>
        </html>`;
  }

  get onDidChange(): vscode.Event<vscode.Uri> {
    return this._onDidChange.event;
  }

  public update(uri: vscode.Uri) {
    if (!this._waiting) {
      this._waiting = true;
      setTimeout(() => {
        this._waiting = false;
        this._onDidChange.fire(uri);
      }, 300);
    }
  }

  private getCspForResource(resource: vscode.Uri, nonce: string): string {
    switch (this.cspArbiter.getSecurityLevelForResource(resource)) {
      case MarkdownPreviewSecurityLevel.AllowInsecureContent:
        return `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src 'self' http: https: data:; media-src 'self' http: https: data:; script-src 'nonce-${nonce}'; style-src 'self' 'unsafe-inline' http: https: data:; font-src 'self' http: https: data:;">`;

      case MarkdownPreviewSecurityLevel.AllowScriptsAndAllContent:
        return '';

      case MarkdownPreviewSecurityLevel.Strict:
      default:
        return `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src 'self' https: data:; media-src 'self' https: data:; script-src 'nonce-${nonce}'; style-src 'self' 'unsafe-inline' https: data:; font-src 'self' https: data:;">`;
    }
  }
}

export function showPuppetStrings(langID:string, uri?: vscode.Uri, sideBySide: boolean = false) {
  let resource = uri;
  if (!(resource instanceof vscode.Uri)) {
    if (vscode.window.activeTextEditor) {
      // we are relaxed and don't check for puppet files
      // TODO: Should we? Probably
      resource = vscode.window.activeTextEditor.document.uri;
    }
  }

  if (reporter) {
    reporter.sendTelemetryEvent(messages.PuppetCommandStrings.PuppetStringsToTheSideCommandId);
  }

  const thenable = vscode.commands.executeCommand('vscode.previewHtml',
    getPuppetStringsUri(langID, resource),
    getViewColumn(sideBySide),
    `Puppet Strings '${path.basename(resource.fsPath)}'`);

  return thenable;
}

export function getViewColumn(sideBySide: boolean): vscode.ViewColumn | undefined {
  const active = vscode.window.activeTextEditor;
  if (!active) {
    return vscode.ViewColumn.One;
  }

  if (!sideBySide) {
    return active.viewColumn;
  }

  switch (active.viewColumn) {
    case vscode.ViewColumn.One:
      return vscode.ViewColumn.Two;
    case vscode.ViewColumn.Two:
      return vscode.ViewColumn.Three;
  }

  return active.viewColumn;
}
