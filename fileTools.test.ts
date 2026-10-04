/**
 * Тестовый набор для FileToolSuite на TypeScript.
 * Запуск: node --test fileTools.test.ts
 */

import { test, describe, beforeEach, afterEach } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { FileToolSuite } from './fileTools.ts';

describe('FileToolSuite Tests', () => {
  let tempDir: string;
  let tools: FileToolSuite;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetools-test-'));
    tools = new FileToolSuite(tempDir);
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  // =========================================================================
  // ТЕСТЫ: writeToFile
  // =========================================================================
  describe('writeToFile', () => {
    test('Создание нового файла в новой вложенной папке', () => {
      const target = 'src/components/Button.tsx';
      const code = 'export const Button = () => <button>Click</button>;';

      const res = tools.writeToFile({ targetFile: target, codeContent: code });

      assert.strictEqual(res.success, true);
      assert.match(res.output, /Created file/);
      assert.strictEqual(fs.readFileSync(path.join(tempDir, target), 'utf-8'), code);
    });

    test('Защита от случайной перезаписи без флага overwrite', () => {
      const target = 'config.json';
      tools.writeToFile({ targetFile: target, codeContent: '{"version": 1}' });

      const res = tools.writeToFile({ targetFile: target, codeContent: '{"version": 2}' });

      assert.strictEqual(res.success, false);
      assert.match(res.error || '', /File already exists/);
      assert.strictEqual(fs.readFileSync(path.join(tempDir, target), 'utf-8'), '{"version": 1}');
    });

    test('Успешная перезапись при наличии overwrite=true', () => {
      const target = 'config.json';
      tools.writeToFile({ targetFile: target, codeContent: '{"version": 1}' });

      const res = tools.writeToFile({
        targetFile: target,
        codeContent: '{"version": 2}',
        overwrite: true,
      });

      assert.strictEqual(res.success, true);
      assert.match(res.output, /Overwrote file/);
      assert.strictEqual(fs.readFileSync(path.join(tempDir, target), 'utf-8'), '{"version": 2}');
    });

    test('Дозапись в конец файла при наличии append=true', () => {
      const target = 'log.txt';
      tools.writeToFile({ targetFile: target, codeContent: 'Line 1\n' });

      const res = tools.writeToFile({
        targetFile: target,
        codeContent: 'Line 2\n',
        append: true,
      });

      assert.strictEqual(res.success, true);
      assert.match(res.output, /Appended/);
      assert.strictEqual(fs.readFileSync(path.join(tempDir, target), 'utf-8'), 'Line 1\nLine 2\n');
    });

    test('Ошибка при одновременном указании overwrite=true и append=true', () => {
      const res = tools.writeToFile({
        targetFile: 'test.txt',
        codeContent: 'data',
        overwrite: true,
        append: true,
      });

      assert.strictEqual(res.success, false);
      assert.match(res.error || '', /Cannot specify both overwrite=true and append=true/);
    });
  });

  // =========================================================================
  // ТЕСТЫ: viewFile
  // =========================================================================
  describe('viewFile', () => {
    test('Чтение файла с 1-индексированной нумерацией строк', () => {
      const content = 'First Line\nSecond Line\nThird Line';
      tools.writeToFile({ targetFile: 'sample.txt', codeContent: content });

      const res = tools.viewFile({ targetFile: 'sample.txt' });

      assert.strictEqual(res.success, true);
      assert.match(res.output, /Total Lines: 3/);
      assert.match(res.output, /1: First Line/);
      assert.match(res.output, /2: Second Line/);
      assert.match(res.output, /3: Third Line/);
    });

    test('Срез строк по startLine и endLine', () => {
      const content = ['line 1', 'line 2', 'line 3', 'line 4', 'line 5'].join('\n');
      tools.writeToFile({ targetFile: 'lines.txt', codeContent: content });

      const res = tools.viewFile({ targetFile: 'lines.txt', startLine: 2, endLine: 4 });

      assert.strictEqual(res.success, true);
      assert.match(res.output, /Showing lines 2 to 4/);
      assert.doesNotMatch(res.output, /1: line 1/);
      assert.match(res.output, /2: line 2/);
      assert.match(res.output, /3: line 3/);
      assert.match(res.output, /4: line 4/);
      assert.doesNotMatch(res.output, /5: line 5/);
    });

    test('Ошибка при недопустимом диапазоне строк (startLine > endLine)', () => {
      tools.writeToFile({ targetFile: 'test.txt', codeContent: 'a\nb\nc' });

      const res = tools.viewFile({ targetFile: 'test.txt', startLine: 3, endLine: 2 });

      assert.strictEqual(res.success, false);
      assert.match(res.error || '', /must be less than or equal to EndLine/);
    });

    test('Безопасное отображение бинарных файлов', () => {
      const binPath = path.join(tempDir, 'sample.bin');
      const binBuffer = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x00]);
      fs.writeFileSync(binPath, binBuffer);

      const res = tools.viewFile({ targetFile: 'sample.bin' });

      assert.strictEqual(res.success, true);
      assert.match(res.output, /Binary file: sample\.bin/);
    });
  });

  // =========================================================================
  // ТЕСТЫ: replaceFileContent
  // =========================================================================
  describe('replaceFileContent', () => {
    test('Точная замена блока кода в указанном диапазоне строк', () => {
      const initialCode = [
        'function calculate(x: number) {',
        '  const multiplier = 2;',
        '  return x * multiplier;',
        '}',
      ].join('\n');
      tools.writeToFile({ targetFile: 'math.ts', codeContent: initialCode });

      const res = tools.replaceFileContent({
        targetFile: 'math.ts',
        startLine: 2,
        endLine: 3,
        targetContent: '  const multiplier = 2;\n  return x * multiplier;',
        replacementContent: '  const multiplier = 10;\n  return x * multiplier;',
        instruction: 'Update multiplier to 10',
      });

      assert.strictEqual(res.success, true);
      assert.match(res.output, /Successfully updated/);
      assert.match(res.diff || '', /\+   const multiplier = 10;/);

      const finalCode = fs.readFileSync(path.join(tempDir, 'math.ts'), 'utf-8');
      assert.strictEqual(
        finalCode,
        [
          'function calculate(x: number) {',
          '  const multiplier = 10;',
          '  return x * multiplier;',
          '}',
        ].join('\n')
      );
    });

    test('Сохранение точных отступов (табы и пробелы)', () => {
      const codeWithTabs = 'class Test {\n\t\tprivate secret = 42;\n}';
      tools.writeToFile({ targetFile: 'tabs.ts', codeContent: codeWithTabs });

      const res = tools.replaceFileContent({
        targetFile: 'tabs.ts',
        startLine: 2,
        endLine: 2,
        targetContent: '\t\tprivate secret = 42;',
        replacementContent: '\t\tprivate secret = 100;',
      });

      assert.strictEqual(res.success, true);
      const updated = fs.readFileSync(path.join(tempDir, 'tabs.ts'), 'utf-8');
      assert.strictEqual(updated, 'class Test {\n\t\tprivate secret = 100;\n}');
    });

    test('Сохранение окончаний строк Windows CRLF (\\r\\n)', () => {
      const crlfCode = 'first line\r\nsecond line\r\nthird line';
      tools.writeToFile({ targetFile: 'crlf.txt', codeContent: crlfCode });

      const res = tools.replaceFileContent({
        targetFile: 'crlf.txt',
        startLine: 2,
        endLine: 2,
        targetContent: 'second line',
        replacementContent: 'MODIFIED line',
      });

      assert.strictEqual(res.success, true);
      const rawBuffer = fs.readFileSync(path.join(tempDir, 'crlf.txt'));
      assert.strictEqual(rawBuffer.includes(Buffer.from('\r\n')), true);
      assert.strictEqual(rawBuffer.toString('utf-8'), 'first line\r\nMODIFIED line\r\nthird line');
    });

    test('Умная диагностика: обнаружение сдвига строк, если блок найден в другом месте', () => {
      const code = [
        '// Header',
        '// Comments',
        '// More comments',
        'const SECRET_KEY = "XYZ";',
        'console.log("ready");',
      ].join('\n');
      tools.writeToFile({ targetFile: 'app.ts', codeContent: code });

      // Намеренно ищем SECRET_KEY в строках 1-2, хотя он находится в строке 4
      const res = tools.replaceFileContent({
        targetFile: 'app.ts',
        startLine: 1,
        endLine: 2,
        targetContent: 'const SECRET_KEY = "XYZ";',
        replacementContent: 'const SECRET_KEY = "NEW";',
      });

      assert.strictEqual(res.success, false);
      assert.match(res.output, /TargetContent WAS FOUND in the file, but at lines \[4-4\]/);
      assert.match(res.output, /The line numbers likely shifted/);
    });

    test('Умная диагностика: обнаружение несовпадения отступов', () => {
      const code = ['function init() {', '    const name = "Antigravity";', '}'].join('\n');
      tools.writeToFile({ targetFile: 'indent.ts', codeContent: code });

      // Передаём 2 пробела вместо 4
      const res = tools.replaceFileContent({
        targetFile: 'indent.ts',
        startLine: 2,
        endLine: 2,
        targetContent: '  const name = "Antigravity";',
        replacementContent: '  const name = "Updated";',
      });

      assert.strictEqual(res.success, false);
      assert.match(res.output, /Content matched when ignoring indentation and whitespace/);
    });

    test('Защита от двусмысленности: ошибка при нескольких одинаковых строках в окне', () => {
      const code = ['item', 'item', 'item'].join('\n');
      tools.writeToFile({ targetFile: 'list.txt', codeContent: code });

      const res = tools.replaceFileContent({
        targetFile: 'list.txt',
        startLine: 1,
        endLine: 3,
        targetContent: 'item',
        replacementContent: 'replaced',
      });

      assert.strictEqual(res.success, false);
      assert.match(res.error || '', /Ambiguous replacement target/);
      assert.match(res.output, /Found 3 occurrences/);
    });

    test('Успешная замена нескольких совпадений при allowMultiple=true', () => {
      const code = ['foo', 'bar', 'foo'].join('\n');
      tools.writeToFile({ targetFile: 'multi.txt', codeContent: code });

      const res = tools.replaceFileContent({
        targetFile: 'multi.txt',
        startLine: 1,
        endLine: 3,
        targetContent: 'foo',
        replacementContent: 'baz',
        allowMultiple: true,
      });

      assert.strictEqual(res.success, true);
      const updated = fs.readFileSync(path.join(tempDir, 'multi.txt'), 'utf-8');
      assert.strictEqual(updated, ['baz', 'bar', 'baz'].join('\n'));
    });
  });

  // =========================================================================
  // ТЕСТЫ: Схемы инструментов для LLM
  // =========================================================================
  describe('LLM Tool Schemas', () => {
    test('Предоставляет корректные JSON-схемы для регистрации в LLM', () => {
      const definitions = FileToolSuite.getToolDefinitions();
      assert.strictEqual(Array.isArray(definitions), true);
      assert.strictEqual(definitions.length, 3);

      const names = definitions.map((d) => d.name);
      assert.deepStrictEqual(names, ['viewFile', 'writeToFile', 'replaceFileContent']);

      for (const def of definitions) {
        assert.ok(def.name);
        assert.ok(def.description);
        assert.strictEqual(def.parameters.type, 'object');
        assert.ok(Array.isArray(def.parameters.required));
      }
    });
  });
});
