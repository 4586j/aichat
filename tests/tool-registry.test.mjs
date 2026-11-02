import test from 'node:test';
import assert from 'node:assert/strict';
import { safeEvaluateMath, createToolRegistry } from '../lib/tool-registry.mjs';
import { createMcpManager } from '../lib/mcp-manager.mjs';

test('safeEvaluateMath computes valid math expressions and blocks unsafe execution', () => {
  // Valid math
  assert.equal(safeEvaluateMath('12 + 34'), 46);
  assert.equal(safeEvaluateMath('(10 + 20) * 3 - 5'), 85);
  assert.equal(safeEvaluateMath('2 ^ 10'), 1024);
  assert.equal(safeEvaluateMath('Math.sqrt(144) + Math.abs(-10)'), 22);
  assert.equal(safeEvaluateMath('Math.round(3.14159 * 100) / 100'), 3.14);

  // Unsafe / malicious inputs
  assert.throws(() => safeEvaluateMath('process.exit(1)'), /未授权的函数或标识符|不允许的字符/);
  assert.throws(() => safeEvaluateMath('eval("2+2")'), /未授权的函数或标识符|不允许的字符/);
  assert.throws(() => safeEvaluateMath('Function("return 1")()'), /未授权的函数或标识符|不允许的字符/);
  assert.throws(() => safeEvaluateMath('__proto__'), /未授权的函数或标识符|不允许的字符/);
  assert.throws(() => safeEvaluateMath('require("fs")'), /未授权的函数或标识符|不允许的字符/);
  assert.throws(() => safeEvaluateMath(''), /不能为空/);
  assert.throws(() => safeEvaluateMath('1/0'), /有限数值/);
});

test('createToolRegistry manages built-in skills and execution', async () => {
  const mockKnowledge = {
    search(query, limit) {
      return [{ id: 'c1', name: '系统指南', index: 0, content: `关于 ${query} 的说明` }];
    }
  };

  const registry = createToolRegistry({ knowledge: mockKnowledge });

  // 1. Calculator
  assert.ok(registry.has('calculator'));
  const calcResult = await registry.execute('calculator', { expression: '15 * 6' });
  assert.deepEqual(calcResult, { expression: '15 * 6', result: 90 });

  // 2. System time
  assert.ok(registry.has('get_system_time'));
  const timeResult = await registry.execute('get_system_time', {});
  assert.ok(timeResult.iso);
  assert.ok(timeResult.weekday);

  // 3. Knowledge deep search
  assert.ok(registry.has('knowledge_deep_search'));
  const searchResult = await registry.execute('knowledge_deep_search', { query: '向量知识库', limit: 2 });
  assert.equal(searchResult.count, 1);
  assert.equal(searchResult.results[0].name, '系统指南');

  // Definitions list
  const defs = registry.listDefinitions();
  assert.ok(defs.length >= 3);
  assert.ok(defs.some(d => d.function.name === 'calculator'));
});

test('createMcpManager syncs MCP tools into ToolRegistry and proxies calls', async () => {
  const registry = createToolRegistry();
  const mcpManager = createMcpManager({ toolRegistry: registry });

  let calledWith = null;
  const mockMcpClient = {
    async initialize() {},
    async listTools() {
      return [
        {
          name: 'mcp_file_read',
          description: '从外部文件系统读取指定文件',
          readOnly: true,
          inputSchema: {
            type: 'object',
            properties: { path: { type: 'string' } },
            required: ['path']
          }
        }
      ];
    },
    async callTool(name, args, context) {
      calledWith = { name, args, context };
      return { content: [{ type: 'text', text: '文件内容测试' }] };
    },
    close() {}
  };

  mcpManager.registerServer('mock_fs', mockMcpClient);
  await mcpManager.syncAllTools();

  assert.ok(registry.has('mcp_file_read'));
  const tool = registry.getTool('mcp_file_read');
  assert.equal(tool.safe, true);
  assert.equal(tool.source, 'mcp');

  const executionResult = await registry.execute('mcp_file_read', { path: '/tmp/test.txt' });
  assert.deepEqual(calledWith, { name: 'mcp_file_read', args: { path: '/tmp/test.txt' }, context: {} });
  assert.equal(executionResult.content[0].text, '文件内容测试');

  mcpManager.closeAll();
});
