export const SSE_EVENTS = Object.freeze({
  STATUS: 'status',
  REASONING: 'reasoning',
  CONTENT: 'content',
  THOUGHT_STEP: 'thought_step',
  APPROVAL_REQUESTED: 'approval_requested',
  TOOL_RESULT: 'tool_result',
  USER_MESSAGE: 'user_message',
  SPEAKER_START: 'speaker_start',
  SPEAKER_DONE: 'speaker_done',
  DONE: 'done',
  ERROR: 'error',
});

export const SSE_PHASES = Object.freeze({
  THINKING: 'thinking',
  PLANNING: 'planning',
  FINALIZING: 'finalizing',
  REVIEWING: 'reviewing',
  REFLECTING: 'reflecting',
});
