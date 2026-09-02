const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const http = require('http');

let statusBarItem;
let fileWatcher;
let ipcServer;
let pollInterval;

let currentState = {
  status: 'idle', // 'idle' | 'running' | 'completed' | 'error'
  taskTitle: '',
  currentStep: 0,
  totalSteps: 0,
  progressPercent: 0,
  currentAction: 'Ready',
  toolName: '',
  completedAt: null,
  hasPlan: false,
  objectives: []
};

function renderProgressBar(percent, length = 10) {
  const clamped = Math.max(0, Math.min(100, percent || 0));
  const filledCount = Math.round((clamped / 100) * length);
  const emptyCount = length - filledCount;
  return '█'.repeat(filledCount) + '░'.repeat(emptyCount);
}

function findLatestImplementationPlan() {
  const candidates = [];

  // Workspace scan
  if (vscode.workspace.workspaceFolders) {
    for (const folder of vscode.workspace.workspaceFolders) {
      const p = path.join(folder.uri.fsPath, 'implementation_plan.md');
      if (fs.existsSync(p)) {
        try { candidates.push({ path: p, mtime: fs.statSync(p).mtimeMs }); } catch (_) {}
      }
      const pAgents = path.join(folder.uri.fsPath, '.agents', 'implementation_plan.md');
      if (fs.existsSync(pAgents)) {
        try { candidates.push({ path: pAgents, mtime: fs.statSync(pAgents).mtimeMs }); } catch (_) {}
      }
    }
  }

  // Antigravity Brain scan
  const homeDir = process.env.USERPROFILE || process.env.HOME || '';
  const brainDir = path.join(homeDir, '.gemini', 'antigravity-ide', 'brain');
  if (fs.existsSync(brainDir)) {
    try {
      const dirs = fs.readdirSync(brainDir);
      for (const d of dirs) {
        const planFile = path.join(brainDir, d, 'implementation_plan.md');
        if (fs.existsSync(planFile)) {
          try { candidates.push({ path: planFile, mtime: fs.statSync(planFile).mtimeMs }); } catch (_) {}
        }
      }
    } catch (_) {}
  }

  if (candidates.length === 0) return null;
  candidates.sort((a, b) => b.mtime - a.mtime);
  return candidates[0].path;
}

function parseImplementationPlan(filePath) {
  try {
    if (!filePath || !fs.existsSync(filePath)) return null;
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split(/\r?\n/);
    const objectives = [];
    let title = '';

    for (const line of lines) {
      if (!title && line.startsWith('# ')) {
        title = line.replace('# ', '').trim();
      }
      const trimmed = line.trim();
      if (trimmed.startsWith('- [ ]') || trimmed.startsWith('- [x]') || trimmed.startsWith('- [X]')) {
        const done = trimmed.startsWith('- [x]') || trimmed.startsWith('- [X]');
        let text = trimmed.replace(/^-\s*\[[ xX]\]\s*/, '').trim();
        text = text.replace(/^\*\*\[.*?\]\*\*\s*/, '').trim();
        objectives.push({ title: text, done });
      }
    }

    if (objectives.length > 0) {
      const completed = objectives.filter(o => o.done).length;
      const total = objectives.length;
      const percent = Math.round((completed / total) * 100);
      const activeObj = objectives.find(o => !o.done);

      return {
        hasPlan: true,
        taskTitle: title || 'Current Plan',
        objectives,
        totalSteps: total,
        currentStep: completed,
        progressPercent: percent,
        activeObjectiveTitle: activeObj ? activeObj.title : 'Finalizing...'
      };
    }
  } catch (_) {}
  return null;
}

function formatTooltip(state) {
  const md = new vscode.MarkdownString();
  md.isTrusted = true;
  md.supportHtml = true;

  const statusIcon = state.status === 'running' ? '⚡' : state.status === 'completed' ? '✅' : state.status === 'error' ? '❌' : '🟢';
  md.appendMarkdown(`### ${statusIcon} Antigravity Task HUD\n\n`);

  if (state.hasPlan && state.totalSteps > 0) {
    const percent = Math.round(state.progressPercent || 0);
    const bar = renderProgressBar(percent, 16);
    md.appendMarkdown(`**Task**: ${state.taskTitle || 'Active Plan'}\n\n`);
    md.appendMarkdown(`**Progress**: \`[${bar}] ${percent}%\` *(Objective ${state.currentStep} of ${state.totalSteps} completed)*\n\n`);
  } else {
    md.appendMarkdown(`**Status**: \`${state.status.toUpperCase()}\`\n\n`);
    if (state.taskTitle) {
      md.appendMarkdown(`**Task**: ${state.taskTitle}\n\n`);
    }
  }

  if (state.currentAction && state.currentAction !== 'Ready' && state.currentAction !== 'Idle') {
    md.appendMarkdown(`**Active Activity**: \`${state.currentAction}\`\n\n`);
  }

  if (state.toolName) {
    md.appendMarkdown(`**Active Tool**: \`${state.toolName}\`\n\n`);
  }

  if (state.objectives && state.objectives.length > 0) {
    md.appendMarkdown(`---\n**📋 Objective Checklist**:\n`);
    state.objectives.forEach(obj => {
      const check = obj.done ? '[x]' : '[ ]';
      md.appendMarkdown(`- ${check} ${obj.title}\n`);
    });
    md.appendMarkdown(`\n`);
  }

  md.appendMarkdown(`---\n*Click to open interactive dashboard*`);
  return md;
}

function syncGroundTruth() {
  const planPath = findLatestImplementationPlan();
  if (planPath) {
    const planData = parseImplementationPlan(planPath);
    if (planData) {
      currentState.hasPlan = true;
      currentState.taskTitle = planData.taskTitle;
      currentState.objectives = planData.objectives;
      currentState.totalSteps = planData.totalSteps;
      currentState.currentStep = planData.currentStep;
      currentState.progressPercent = planData.progressPercent;

      if (planData.currentStep === planData.totalSteps && planData.totalSteps > 0) {
        if (currentState.status !== 'completed') {
          currentState.status = 'completed';
          currentState.completedAt = Date.now();
        }
      }
    }
  }

  // Auto-decay from completed to ready after 4s
  if (currentState.status === 'completed' && currentState.completedAt) {
    if (Date.now() - currentState.completedAt > 4000) {
      currentState.status = 'idle';
      currentState.progressPercent = 0;
      currentState.currentAction = 'Ready';
      currentState.toolName = '';
      currentState.completedAt = null;
      currentState.hasPlan = false;
    }
  }

  updateStatusBarUI();
}

function updateStatusBarUI() {
  if (!statusBarItem) return;

  const config = vscode.workspace.getConfiguration('antigravity.progress');
  const barLen = config.get('barLength') || 10;
  const showTool = config.get('showToolName') !== false;

  let color = undefined;
  let text = '';
  const percent = Math.round(currentState.progressPercent || 0);
  const bar = renderProgressBar(percent, barLen);

  switch (currentState.status) {
    case 'running': {
      const icon = '$(sync~spin)';
      color = new vscode.ThemeColor('statusBarItem.prominentForeground');

      if (currentState.hasPlan && currentState.totalSteps > 0) {
        text = `${icon} [${bar}] ${percent}% (${currentState.currentStep}/${currentState.totalSteps})`;
      } else {
        text = `${icon} Working...`;
      }

      if (showTool && currentState.currentAction && currentState.currentAction !== 'Ready' && currentState.currentAction !== 'Idle') {
        const truncatedAction = currentState.currentAction.length > 28
          ? currentState.currentAction.substring(0, 25) + '...'
          : currentState.currentAction;
        text += ` • ${truncatedAction}`;
      }
      break;
    }

    case 'completed': {
      const icon = '$(pass-filled)';
      color = new vscode.ThemeColor('terminal.ansiGreen');
      text = `${icon} [${renderProgressBar(100, barLen)}] Done`;
      break;
    }

    case 'error': {
      const icon = '$(error)';
      color = new vscode.ThemeColor('statusBarItem.errorForeground');
      text = `${icon} Antigravity: Error`;
      break;
    }

    case 'idle':
    default: {
      const icon = '$(sparkle)';
      text = `${icon} Antigravity: Ready`;
      break;
    }
  }

  if (statusBarItem.text !== text) {
    statusBarItem.text = text;
  }
  statusBarItem.color = color;
  statusBarItem.tooltip = formatTooltip(currentState);
  statusBarItem.show();
}

function getProgressFilePaths() {
  const paths = [];
  if (vscode.workspace.workspaceFolders) {
    for (const folder of vscode.workspace.workspaceFolders) {
      paths.push(path.join(folder.uri.fsPath, '.agents', 'task_progress.json'));
      paths.push(path.join(folder.uri.fsPath, 'task_progress.json'));
    }
  }
  const homeDir = process.env.USERPROFILE || process.env.HOME || '';
  if (homeDir) {
    paths.push(path.join(homeDir, '.gemini', 'antigravity-ide', 'task_progress.json'));
  }
  return paths;
}

function loadStateFromFile(filePath) {
  try {
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, 'utf8');
      if (raw && raw.trim().length > 0) {
        const parsed = JSON.parse(raw);
        currentState = Object.assign({}, currentState, parsed);
        syncGroundTruth();
        return true;
      }
    }
  } catch (_) {}
  return false;
}

function setupFileWatchers(context) {
  try {
    if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
      const pattern = new vscode.RelativePattern(vscode.workspace.workspaceFolders[0], '**/{.agents/task_progress.json,task_progress.json,implementation_plan.md}');
      fileWatcher = vscode.workspace.createFileSystemWatcher(pattern);

      const onChange = () => syncGroundTruth();
      fileWatcher.onDidChange(onChange);
      fileWatcher.onDidCreate(onChange);
      fileWatcher.onDidDelete(() => {
        currentState.status = 'idle';
        currentState.currentAction = 'Ready';
        currentState.hasPlan = false;
        currentState.progressPercent = 0;
        updateStatusBarUI();
      });

      context.subscriptions.push(fileWatcher);
    }

    pollInterval = setInterval(() => {
      syncGroundTruth();
    }, 750);

    context.subscriptions.push({
      dispose: () => clearInterval(pollInterval)
    });
  } catch (_) {}
}

function setupIPCServer(context) {
  try {
    ipcServer = http.createServer((req, res) => {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

      if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
      }

      if (req.method === 'POST') {
        let body = '';
        req.on('data', chunk => { body += chunk.toString(); });
        req.on('end', () => {
          try {
            const data = JSON.parse(body);
            currentState = Object.assign({}, currentState, data);
            syncGroundTruth();
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ status: 'ok' }));
          } catch (e) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: e.message }));
          }
        });
      } else {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(currentState));
      }
    });

    ipcServer.on('error', () => {});
    ipcServer.listen(49153, '127.0.0.1');

    context.subscriptions.push({
      dispose: () => {
        try { ipcServer.close(); } catch (_) {}
      }
    });
  } catch (_) {}
}

function showDashboardQuickPick() {
  const items = [];
  const percent = Math.round(currentState.progressPercent || 0);
  const bar = renderProgressBar(percent, 12);

  if (currentState.hasPlan && currentState.totalSteps > 0) {
    items.push({
      label: `$(checklist) Plan: ${currentState.taskTitle || 'Active Plan'}`,
      description: `[${bar}] ${percent}%`,
      detail: `Status: ${currentState.status.toUpperCase()} | Completed Objectives: ${currentState.currentStep} of ${currentState.totalSteps}`
    });
  } else {
    items.push({
      label: `$(pulse) Status: ${currentState.status.toUpperCase()}`,
      description: currentState.currentAction || 'Ready',
      detail: currentState.toolName ? `Active Tool: ${currentState.toolName}` : 'Antigravity Idle'
    });
  }

  if (currentState.currentAction && currentState.currentAction !== 'Ready') {
    items.push({
      label: `$(gear) Activity: ${currentState.currentAction}`,
      description: currentState.toolName ? `Tool: ${currentState.toolName}` : ''
    });
  }

  if (currentState.objectives && currentState.objectives.length > 0) {
    items.push({
      label: `--- Objectives Checklist ---`,
      kind: vscode.QuickPickItemKind.Separator
    });

    currentState.objectives.forEach(obj => {
      const icon = obj.done ? '$(pass)' : '$(circle-large-outline)';
      items.push({
        label: `${icon} ${obj.title}`,
        description: obj.done ? 'Done' : 'Pending'
      });
    });
  }

  items.push({
    label: `--- Actions ---`,
    kind: vscode.QuickPickItemKind.Separator
  });

  items.push({
    label: `$(sync) Refresh & Re-sync Plan`,
    description: 'Force re-scan of implementation plan',
    action: 'sync'
  });

  items.push({
    label: `$(trash) Reset State to Ready`,
    description: 'Clear the tracker and reset to Ready',
    action: 'reset'
  });

  vscode.window.showQuickPick(items, {
    placeHolder: `Antigravity HUD • ${currentState.status.toUpperCase()}`,
    matchOnDescription: true,
    matchOnDetail: true
  }).then(selected => {
    if (!selected) return;

    if (selected.action === 'sync') {
      syncGroundTruth();
      vscode.window.showInformationMessage('Antigravity HUD synchronized.');
    } else if (selected.action === 'reset') {
      currentState = {
        status: 'idle',
        taskTitle: '',
        currentStep: 0,
        totalSteps: 0,
        progressPercent: 0,
        currentAction: 'Ready',
        toolName: '',
        completedAt: null,
        hasPlan: false,
        objectives: []
      };
      updateStatusBarUI();
      vscode.window.showInformationMessage('Antigravity progress reset to Ready.');
    }
  });
}

function activate(context) {
  const config = vscode.workspace.getConfiguration('antigravity.progress');
  const alignment = config.get('alignment') === 'right' ? vscode.StatusBarAlignment.Right : vscode.StatusBarAlignment.Left;
  const priority = config.get('priority') || 100;

  statusBarItem = vscode.window.createStatusBarItem(alignment, priority);
  statusBarItem.command = 'atk.liveProgress.showDashboard';
  context.subscriptions.push(statusBarItem);

  context.subscriptions.push(
    vscode.commands.registerCommand('atk.liveProgress.showDashboard', () => {
      showDashboardQuickPick();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('atk.liveProgress.reset', () => {
      currentState.status = 'idle';
      currentState.progressPercent = 0;
      currentState.currentAction = 'Ready';
      currentState.hasPlan = false;
      updateStatusBarUI();
    })
  );

  setupFileWatchers(context);
  setupIPCServer(context);
  syncGroundTruth();
}

function deactivate() {
  if (statusBarItem) statusBarItem.dispose();
  if (pollInterval) clearInterval(pollInterval);
  if (ipcServer) {
    try { ipcServer.close(); } catch (_) {}
  }
}

module.exports = {
  activate,
  deactivate
};
