/**
 * Демонстрация работы FileToolSuite в реальном сценарии AI-агента.
 * Запуск: node demo.ts
 */

import { FileToolSuite } from './fileTools.ts';

const tools = new FileToolSuite(process.cwd());

console.log('='.repeat(70));
console.log('🤖 ДЕМОНСТРАЦИЯ FILE TOOL SUITE (ИНСТРУМЕНТЫ AI-АГЕНТА)');
console.log('='.repeat(70));

// 1. Создание исходного файла
console.log('\n[ШАГ 1] Создание файла через writeToFile...');
const initialCode = `import express from 'express';

const app = express();
const PORT = 3000;

app.get('/api/status', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

app.listen(PORT, () => {
  console.log(\`Server is running on http://localhost:\${PORT}\`);
});
`;

const writeRes = tools.writeToFile({
  targetFile: 'demoServer.ts',
  codeContent: initialCode,
  overwrite: true,
  description: 'Создание базового Express сервера',
});
console.log('✅ Результат writeToFile:\n', writeRes.output);

// 2. Чтение файла перед редактированием (Ground Truth)
console.log('\n[ШАГ 2] Чтение файла через viewFile (диапазон строк 5-9)...');
const viewRes = tools.viewFile({
  targetFile: 'demoServer.ts',
  startLine: 5,
  endLine: 9,
});
console.log('📄 Снимок строк с диска:\n', viewRes.output);

// 3. Хирургическое редактирование с генерацией Diff
console.log('[ШАГ 3] Хирургическое обновление эндпоинта через replaceFileContent...');
const replaceRes = tools.replaceFileContent({
  targetFile: 'demoServer.ts',
  startLine: 6,
  endLine: 8,
  targetContent: `app.get('/api/status', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});`,
  replacementContent: `app.get('/api/status', (req, res) => {
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    agent: 'Antigravity File Tools'
  });
});`,
  instruction: 'Добавлены поля timestamp и agent в ответ API',
});
console.log('✅ Результат replaceFileContent:\n', replaceRes.output);

// 4. Демонстрация умной самодиагностики при ошибке поиска
console.log('\n[ШАГ 4] Демонстрация самоисправления (ошибка в номерах строк)...');
const failRes = tools.replaceFileContent({
  targetFile: 'demoServer.ts',
  startLine: 1,
  endLine: 3,
  targetContent: `app.listen(PORT, () => {`,
  replacementContent: `app.listen(8080, () => {`,
});
console.log('❌ Ответ инструмента агенту для самокоррекции:\n', failRes.output);

console.log('\n' + '='.repeat(70));
console.log('🎉 Все операции выполнены надежно и атомарно!');
console.log('='.repeat(70));
