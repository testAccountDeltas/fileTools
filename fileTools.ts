/**
 * File Tool Suite — Полный набор инструментов для работы с файлами для AI-агентов на TypeScript.
 *
 * Включает:
 * - viewFile: Чтение с 1-индексированной нумерацией строк, пагинацией и срезами.
 * - replaceFileContent: Точечная замена блоков кода в заданном окне строк [startLine, endLine]
 *   с защитой от сдвига строк, сохранением отступов, CRLF/LF и умной диагностикой.
 * - writeToFile: Атомарная запись, автосоздание директорий и защита от перезаписи.
 * - getToolDefinitions: Готовые JSON-схемы для интеграции с LLM (OpenAI, Gemini, Anthropic, MCP).
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

export interface ToolResult {
  success: boolean;
  output: string;
  error?: string;
  diff?: string;
}

export interface ViewFileParams {
  targetFile: string;
  startLine?: number;
  endLine?: number;
  maxLines?: number;
  maxBytes?: number;
  contentOffset?: number;
}

export interface WriteToFileParams {
  targetFile: string;
  codeContent: string;
  overwrite?: boolean;
  append?: boolean;
  description?: string;
}

export interface ReplaceFileContentParams {
  targetFile: string;
  targetContent: string;
  replacementContent: string;
  startLine: number;
  endLine: number;
  allowMultiple?: boolean;
  instruction?: string;
  description?: string;
}

export class FileToolSuite {
  private workspaceRoot: string;

  constructor(workspaceRoot?: string) {
    this.workspaceRoot = path.resolve(workspaceRoot || process.cwd());
  }

  private resolvePath(filePath: string): string {
    return path.isAbsolute(filePath)
      ? path.normalize(filePath)
      : path.resolve(this.workspaceRoot, filePath);
  }

  // =========================================================================
  // 1. VIEW_FILE (Чтение файлов с нумерацией строк и пагинацией)
  // =========================================================================

  public viewFile(params: ViewFileParams): ToolResult {
    const {
      targetFile,
      startLine,
      endLine,
      maxLines = 800,
      maxBytes = 46080,
      contentOffset = 0,
    } = params;

    const absPath = this.resolvePath(targetFile);

    if (!fs.existsSync(absPath)) {
      return {
        success: false,
        output: '',
        error: `File does not exist: ${absPath}`,
      };
    }

    const stat = fs.statSync(absPath);
    if (stat.isDirectory()) {
      return {
        success: false,
        output: '',
        error: `Target path is a directory, not a file: ${absPath}`,
      };
    }

    let buffer: Buffer;
    try {
      const fd = fs.openSync(absPath, 'r');
      try {
        const bytesToRead = stat.size - contentOffset;
        buffer = Buffer.alloc(Math.max(0, bytesToRead));
        fs.readSync(fd, buffer, 0, buffer.length, contentOffset);
      } finally {
        fs.closeSync(fd);
      }
    } catch (err: any) {
      return { success: false, output: '', error: `Failed to read file: ${err.message}` };
    }

    // Проверка на бинарный файл (наличие нулевых байтов в заголовке)
    const checkSample = buffer.subarray(0, Math.min(1024, buffer.length));
    if (checkSample.includes(0)) {
      return {
        success: true,
        output: `[Binary file: ${path.basename(absPath)}, size: ${stat.size} bytes. Direct text viewing not supported.]`,
      };
    }

    const text = buffer.toString('utf-8');
    // Разбиваем на строки, сохраняя логику строк
    const rawLines = text.split(/\r?\n/);
    const totalLines = rawLines.length;

    const actualStart = startLine !== undefined ? Math.max(1, startLine) : 1;
    const actualEnd =
      endLine !== undefined
        ? Math.min(totalLines, endLine)
        : Math.min(totalLines, actualStart + maxLines - 1);

    if (totalLines > 0 && actualStart > totalLines) {
      return {
        success: false,
        output: '',
        error: `StartLine (${actualStart}) exceeds total line count (${totalLines}).`,
      };
    }

    if (totalLines > 0 && actualStart > actualEnd) {
      return {
        success: false,
        output: '',
        error: `StartLine (${actualStart}) must be less than or equal to EndLine (${actualEnd}).`,
      };
    }

    const formattedLines: string[] = [];
    let currentBytes = 0;
    let truncatedByBytes = false;
    let lastRenderedLine = actualStart - 1;

    for (let lineNum = actualStart; lineNum <= actualEnd; lineNum++) {
      const lineContent = rawLines[lineNum - 1];
      const entry = `${lineNum}: ${lineContent}\n`;
      const entryBytes = Buffer.byteLength(entry, 'utf-8');

      if (currentBytes + entryBytes > maxBytes && formattedLines.length > 0) {
        truncatedByBytes = true;
        break;
      }

      formattedLines.push(entry);
      currentBytes += entryBytes;
      lastRenderedLine = lineNum;
    }

    const header = [
      `File Path: ${absPath.replace(/\\/g, '/')}`,
      `Total Lines: ${totalLines}`,
      `Showing lines ${actualStart} to ${lastRenderedLine}`,
    ].join('\n');

    let footer = '';
    if (truncatedByBytes || lastRenderedLine < totalLines) {
      footer = `\n[Notice: Output truncated. To view more, call viewFile with StartLine=${lastRenderedLine + 1}]`;
    }

    return {
      success: true,
      output: `${header}\n\n${formattedLines.join('')}${footer}`,
    };
  }

  // =========================================================================
  // 2. WRITE_TO_FILE (Создание и атомарная запись файлов)
  // =========================================================================

  public writeToFile(params: WriteToFileParams): ToolResult {
    const { targetFile, codeContent, overwrite = false, append = false, description } = params;

    if (overwrite && append) {
      return {
        success: false,
        output: '',
        error: 'Cannot specify both overwrite=true and append=true.',
      };
    }

    const absPath = this.resolvePath(targetFile);
    const fileExists = fs.existsSync(absPath);

    if (fileExists && !overwrite && !append) {
      return {
        success: false,
        output: '',
        error: `File already exists: ${absPath}. Set overwrite=true to replace it, or append=true to add content.`,
      };
    }

    // Создаём родительскую директорию рекурсивно
    const parentDir = path.dirname(absPath);
    try {
      fs.mkdirSync(parentDir, { recursive: true });
    } catch (err: any) {
      return { success: false, output: '', error: `Failed to create directories: ${err.message}` };
    }

    try {
      if (append && fileExists) {
        fs.appendFileSync(absPath, codeContent, 'utf-8');
        return {
          success: true,
          output: `Appended ${Buffer.byteLength(codeContent, 'utf-8')} bytes to '${absPath}'.`,
        };
      }

      // Атомарная запись: пишем во временный файл в той же папке, затем атомарно переименовываем
      const tempFile = path.join(
        parentDir,
        `.tmp_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`
      );
      fs.writeFileSync(tempFile, codeContent, 'utf-8');
      fs.renameSync(tempFile, absPath);

      const action = fileExists && overwrite ? 'Overwrote' : 'Created';
      const lines = codeContent.split('\n').length;
      let msg = `${action} file '${absPath}' successfully (${lines} lines, ${Buffer.byteLength(codeContent, 'utf-8')} bytes).`;
      if (description) msg += ` Description: ${description}`;

      return {
        success: true,
        output: msg,
      };
    } catch (err: any) {
      return { success: false, output: '', error: `Filesystem operation failed: ${err.message}` };
    }
  }

  // =========================================================================
  // 3. REPLACE_FILE_CONTENT (Точечное хирургическое редактирование)
  // =========================================================================

  public replaceFileContent(params: ReplaceFileContentParams): ToolResult {
    const {
      targetFile,
      targetContent,
      replacementContent,
      startLine,
      endLine,
      allowMultiple = false,
      instruction,
    } = params;

    const absPath = this.resolvePath(targetFile);

    if (!fs.existsSync(absPath)) {
      return { success: false, output: '', error: `File not found: ${absPath}` };
    }

    let rawBuffer: Buffer;
    try {
      rawBuffer = fs.readFileSync(absPath);
    } catch (err: any) {
      return { success: false, output: '', error: `Failed to read file: ${err.message}` };
    }

    // Сохранение исходного типа окончаний строк (CRLF vs LF)
    const isCrlf = rawBuffer.includes(Buffer.from('\r\n'));
    const fullText = rawBuffer.toString('utf-8');

    // Нормализация к LF для гарантированно точного сопоставления
    const normalizedFullText = fullText.replace(/\r\n/g, '\n');
    const lines = normalizedFullText.split('\n');
    const totalLines = lines.length;

    // Валидация входных номеров строк
    if (startLine < 1) {
      return { success: false, output: '', error: `StartLine (${startLine}) must be >= 1.` };
    }
    if (startLine > endLine) {
      return {
        success: false,
        output: '',
        error: `StartLine (${startLine}) cannot be greater than EndLine (${endLine}).`,
      };
    }
    if (endLine > totalLines) {
      return {
        success: false,
        output: '',
        error: `EndLine (${endLine}) exceeds total lines in file (${totalLines}).`,
      };
    }

    const normTarget = targetContent.replace(/\r\n/g, '\n');
    const normReplacement = replacementContent.replace(/\r\n/g, '\n');

    // Окно поиска (0-indexed: [startLine - 1, endLine])
    const prefixLines = lines.slice(0, startLine - 1);
    const windowLines = lines.slice(startLine - 1, endLine);
    const suffixLines = lines.slice(endLine);

    const prefixText = prefixLines.length > 0 ? prefixLines.join('\n') + '\n' : '';
    const windowText = windowLines.join('\n');
    const suffixText = suffixLines.length > 0 ? '\n' + suffixLines.join('\n') : '';

    // Подсчёт и поиск точных вхождений targetContent внутри заданного окна
    const matchIndices = this.findMatches(windowText, normTarget);
    const occurrences = matchIndices.length;

    if (occurrences === 0) {
      // Генерация умной диагностики для модели
      const diagnostics = this.generateDiagnostics({
        normalizedFullText,
        windowText,
        normTarget,
        startLine,
        endLine,
        filename: path.basename(absPath),
      });

      return {
        success: false,
        output: diagnostics,
        error: `TargetContent not found in lines [${startLine}, ${endLine}] of '${path.basename(absPath)}'.`,
      };
    }

    if (occurrences > 1 && !allowMultiple) {
      return {
        success: false,
        output:
          `Found ${occurrences} occurrences of TargetContent in range [${startLine}, ${endLine}]. ` +
          'Narrow down your line range or specify allowMultiple=true.',
        error: 'Ambiguous replacement target.',
      };
    }

    // Замена в окне по точным индексам (буквальная, без искажения спецсимволов вроде $1 или $&)
    let newWindowText: string;
    if (allowMultiple) {
      let result = '';
      let lastIndex = 0;
      for (const idx of matchIndices) {
        result += windowText.substring(lastIndex, idx) + normReplacement;
        lastIndex = idx + normTarget.length;
      }
      result += windowText.substring(lastIndex);
      newWindowText = result;
    } else {
      const idx = matchIndices[0];
      newWindowText =
        windowText.substring(0, idx) +
        normReplacement +
        windowText.substring(idx + normTarget.length);
    }

    const newFullText = prefixText + newWindowText + suffixText;

    // Восстановление оригинальных окончаний строк
    const finalContent = isCrlf ? newFullText.replace(/\n/g, '\r\n') : newFullText;

    // Генерация понятного diff
    const diff = this.generateDiff(
      path.basename(absPath),
      normalizedFullText,
      newFullText
    );

    // Атомарная запись на диск
    const parentDir = path.dirname(absPath);
    const tempFile = path.join(
      parentDir,
      `.tmp_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`
    );

    try {
      fs.writeFileSync(tempFile, finalContent, 'utf-8');
      fs.renameSync(tempFile, absPath);
    } catch (err: any) {
      if (fs.existsSync(tempFile)) {
        try { fs.unlinkSync(tempFile); } catch {}
      }
      return { success: false, output: '', error: `Failed to write replaced file: ${err.message}` };
    }

    let summary = `Successfully updated '${absPath}' [${startLine}-${endLine}].`;
    if (instruction) summary += ` (${instruction})`;

    return {
      success: true,
      output: `${summary}\n\nDiff:\n${diff}`,
      diff,
    };
  }

  // =========================================================================
  // Вспомогательные методы
  // =========================================================================

  private findMatches(windowText: string, needle: string): number[] {
    if (!needle) return [];
    const matches: number[] = [];
    let pos = 0;

    const needleHasLeadingWhitespace = needle.startsWith(' ') || needle.startsWith('\t');

    while ((pos = windowText.indexOf(needle, pos)) !== -1) {
      if (needleHasLeadingWhitespace) {
        // Проверяем, не начинается ли совпадение посреди ведущих пробелов строки
        const lineStart = windowText.lastIndexOf('\n', pos - 1) + 1;
        const precedingOnLine = windowText.substring(lineStart, pos);
        const precedingIsWhitespace = precedingOnLine.length > 0 && /^[ \t]+$/.test(precedingOnLine);

        if (precedingIsWhitespace) {
          // Отступ в файле больше, чем переданный в needle (неполный отступ)
          pos += needle.length;
          continue;
        }
      }

      matches.push(pos);
      pos += needle.length;
    }
    return matches;
  }

  private generateDiagnostics(opts: {
    normalizedFullText: string;
    windowText: string;
    normTarget: string;
    startLine: number;
    endLine: number;
    filename: string;
  }): string {
    const { normalizedFullText, windowText, normTarget, startLine, endLine } = opts;
    const lines: string[] = ['=== SEARCH FAILURE DIAGNOSTICS ==='];

    // 1. Проверяем, существует ли этот блок в другом месте файла (сдвиг строк)
    const globalMatches = this.findMatches(normalizedFullText, normTarget);
    if (globalMatches.length > 0) {
      const textBefore = normalizedFullText.substring(0, globalMatches[0]);
      const actualStart = textBefore.split('\n').length;
      const targetLinesCount = normTarget.split('\n').length;
      const actualEnd = actualStart + targetLinesCount - 1;

      if (actualStart !== startLine || actualEnd !== endLine) {
        lines.push(
          `💡 HINT: TargetContent WAS FOUND in the file, but at lines [${actualStart}-${actualEnd}] ` +
            `instead of [${startLine}-${endLine}]. The line numbers likely shifted after a previous edit!`
        );
      }
    }

    // 2. Проверяем несовпадение отступов / хвостовых пробелов
    const stripLines = (str: string) =>
      str
        .split('\n')
        .map((l) => l.trim())
        .join('\n');
    if (stripLines(windowText).includes(stripLines(normTarget))) {
      lines.push(
        '💡 HINT: Content matched when ignoring indentation and whitespace! ' +
          'Please verify leading tabs/spaces in TargetContent.'
      );
    }

    // 3. Выводим точное содержимое текущего диапазона, чтобы агент сразу его увидел
    lines.push(`\nActual lines in [${startLine}-${endLine}]:`);
    lines.push('----------------------------------------');
    const winLines = windowText.split('\n');
    for (let i = 0; i < winLines.length; i++) {
      lines.push(`${startLine + i}: ${JSON.stringify(winLines[i])}`);
    }
    lines.push('----------------------------------------');

    return lines.join('\n');
  }

  private generateDiff(filename: string, oldText: string, newText: string): string {
    const oldLines = oldText.split('\n');
    const newLines = newText.split('\n');
    const out: string[] = [`--- a/${filename}`, `+++ b/${filename}`];

    // Простой и наглядный построчный diff
    let i = 0;
    let j = 0;
    while (i < oldLines.length || j < newLines.length) {
      if (i < oldLines.length && j < newLines.length && oldLines[i] === newLines[j]) {
        i++;
        j++;
      } else {
        const chunkOld: string[] = [];
        const chunkNew: string[] = [];

        while (i < oldLines.length && (j >= newLines.length || oldLines[i] !== newLines[j])) {
          chunkOld.push(`- ${oldLines[i]}`);
          i++;
        }
        while (j < newLines.length && (i >= oldLines.length || oldLines[i] !== newLines[j])) {
          chunkNew.push(`+ ${newLines[j]}`);
          j++;
        }

        out.push(...chunkOld);
        out.push(...chunkNew);
      }
    }

    return out.join('\n');
  }

  // =========================================================================
  // JSON Schemas для LLM Function Calling (OpenAI / Anthropic / Gemini / MCP)
  // =========================================================================

  public static getToolDefinitions() {
    return [
      {
        name: 'viewFile',
        description: 'Read contents of a file with line numbering and bounded slicing.',
        parameters: {
          type: 'object',
          properties: {
            targetFile: { type: 'string', description: 'Absolute or workspace-relative path.' },
            startLine: { type: 'integer', description: 'Starting line (1-indexed, inclusive).' },
            endLine: { type: 'integer', description: 'Ending line (1-indexed, inclusive).' },
            maxLines: { type: 'integer', description: 'Max lines to view at once. Default 800.' },
            maxBytes: { type: 'integer', description: 'Max bytes allowed in output.' },
          },
          required: ['targetFile'],
        },
      },
      {
        name: 'writeToFile',
        description: 'Create a new file or atomically overwrite/append to an existing file.',
        parameters: {
          type: 'object',
          properties: {
            targetFile: { type: 'string', description: 'Path to target file.' },
            codeContent: { type: 'string', description: 'File content to write.' },
            overwrite: { type: 'boolean', description: 'Set true to overwrite existing file.' },
            append: { type: 'boolean', description: 'Set true to append.' },
            description: { type: 'string', description: 'Summary of file creation.' },
          },
          required: ['targetFile', 'codeContent'],
        },
      },
      {
        name: 'replaceFileContent',
        description:
          'Surgically replace exact targetContent inside bounded lines [startLine, endLine].',
        parameters: {
          type: 'object',
          properties: {
            targetFile: { type: 'string', description: 'Path to target file.' },
            targetContent: { type: 'string', description: 'Exact string to be replaced.' },
            replacementContent: { type: 'string', description: 'New string to insert.' },
            startLine: { type: 'integer', description: 'Start line of search window.' },
            endLine: { type: 'integer', description: 'End line of search window.' },
            allowMultiple: { type: 'boolean', description: 'Allow replacing multiple matches.' },
            instruction: { type: 'string', description: 'What this edit does.' },
          },
          required: ['targetFile', 'targetContent', 'replacementContent', 'startLine', 'endLine'],
        },
      },
    ];
  }
}
