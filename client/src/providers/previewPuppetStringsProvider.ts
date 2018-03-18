'use strict';

import * as vscode from 'vscode';
import * as path from 'path';
import { PuppetStringsRequest } from '../messages';
import { ConnectionStatus } from '../interfaces';
import { IConnectionManager } from '../connection';
import * as messages from '../messages';

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

export class PuppetStringsContentProvider implements vscode.TextDocumentContentProvider {
  private _onDidChange = new vscode.EventEmitter<vscode.Uri>();
  private _waiting: boolean = false;
  private _connectionManager: IConnectionManager = undefined;
  private _shownLanguageServerNotAvailable = false;

  constructor(
    private context: vscode.ExtensionContext,
    private connMgr: IConnectionManager
  ) {
    this._connectionManager = connMgr;
  }

  public provideTextDocumentContent(uri: vscode.Uri): Thenable<string> {
    const sourceUri = vscode.Uri.parse(uri.query);
    var thisProvider = this

    return vscode.workspace.openTextDocument(sourceUri).then(document => {
      const initialData = {
        previewUri: uri.toString(),
        source: sourceUri.toString(),
      };

      var ts_hms = new Date();
      var timestamp = ts_hms.getFullYear() + '-' +
                      ("0" + (ts_hms.getMonth() + 1)).slice(-2) + '-' +
                      ("0" + (ts_hms.getDate() + 1)).slice(-2) + ' ' +
                      ("0" + ts_hms.getHours()).slice(-2) + ':' +
                      ("0" + ts_hms.getMinutes()).slice(-2) + ':' +
                      ("0" + ts_hms.getSeconds()).slice(-2);

      return ("Puppet Strings Markdown File " + timestamp);
    });
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
