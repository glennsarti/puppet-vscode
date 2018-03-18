import * as vscode from 'vscode';
import * as messages from '../../src/messages';
import { IConnectionManager } from '../../src/connection';
import { ILogger } from '../../src/logging';
import { PuppetNodeGraphContentProvider, getNodeGraphUri, showNodeGraph } from '../../src/providers/previewNodeGraphProvider';
import { PuppetStringsContentProvider, getPuppetStringsUri, showPuppetStrings } from '../../src/providers/previewPuppetStringsProvider';
import { puppetResourceCommand } from '../commands/puppet/puppetResourceCommand';
import { PuppetFormatDocumentProvider } from '../providers/puppetFormatDocumentProvider';

export function isATextDocumentContentPuppetFile(document: vscode.TextDocument) {
  return document.languageId === 'puppet'
    && document.uri.scheme !== 'puppet'; // prevent processing of own documents
}

export function setupPuppetCommands(langID:string, connManager:IConnectionManager, ctx:vscode.ExtensionContext, logger: ILogger){
  let nodeGraphLangID = langID + '-nodegraph';
  let puppetStringsLangID = langID + '-strings';

  let resourceCommand = new puppetResourceCommand(connManager, logger);
  ctx.subscriptions.push(resourceCommand);
  ctx.subscriptions.push(vscode.commands.registerCommand(messages.PuppetCommandStrings.PuppetResourceCommandId, () => {
    resourceCommand.run();
  }));

  ctx.subscriptions.push(vscode.languages.registerDocumentFormattingEditProvider('puppet', {
    provideDocumentFormattingEdits: (document, options, token) => {
      if (vscode.workspace.getConfiguration('puppet').get('format.enable')) {
        return PuppetFormatDocumentProvider(document, options, connManager)
      } else {
        return []
      }
    }
  }));

  ctx.subscriptions.push(vscode.commands.registerCommand(messages.PuppetCommandStrings.PuppetNodeGraphToTheSideCommandId,
    uri => showNodeGraph(nodeGraphLangID, uri, true))
  );

  ctx.subscriptions.push(vscode.commands.registerCommand(messages.PuppetCommandStrings.PuppetStringsToTheSideCommandId,
    uri => showPuppetStrings(puppetStringsLangID, uri, true))
  );

  ctx.subscriptions.push(vscode.commands.registerCommand(messages.PuppetCommandStrings.PuppetShowConnectionMenuCommandId,
    () => { connManager.showConnectionMenu(); }
  ));

  ctx.subscriptions.push(vscode.commands.registerCommand(messages.PuppetCommandStrings.PuppetShowConnectionLogsCommandId,
    () => { connManager.showLogger(); }
  ));

  ctx.subscriptions.push(vscode.commands.registerCommand(messages.PuppetCommandStrings.PuppetRestartSessionCommandId,
    () => { connManager.restartConnection(); }
  ));

  const contentProvider = new PuppetNodeGraphContentProvider(ctx, connManager);
  const contentProviderRegistration = vscode.workspace.registerTextDocumentContentProvider(nodeGraphLangID, contentProvider);

  ctx.subscriptions.push(vscode.workspace.onDidSaveTextDocument(document => {
    if (isATextDocumentContentPuppetFile(document)) {
      const uri = getNodeGraphUri(nodeGraphLangID, document.uri);
      contentProvider.update(uri);
    }
  }));

  const puppetStringsContentProvider = new PuppetStringsContentProvider(ctx, connManager);
  const puppetStringsContentProviderRegistration = vscode.workspace.registerTextDocumentContentProvider(puppetStringsLangID, puppetStringsContentProvider);

  ctx.subscriptions.push(vscode.workspace.onDidSaveTextDocument(document => {
    if (isATextDocumentContentPuppetFile(document)) {
      const uri = getPuppetStringsUri(puppetStringsLangID, document.uri);
      puppetStringsContentProvider.update(uri);
    }
  }));
}
