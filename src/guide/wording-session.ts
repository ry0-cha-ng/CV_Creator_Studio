import type { AiHandoff, WordingIdeas } from '../../shared/ai';

export type WordingPicked = { hook?: number; title?: number; comment?: number };

export type WordingSession = {
  busy: 'generate' | 'read' | null;
  message: string | null;
  handoff: AiHandoff | null;
  paste: string;
  ideas: WordingIdeas | null;
  picked: WordingPicked;
};

const EMPTY: WordingSession = {
  busy: null,
  message: null,
  handoff: null,
  paste: '',
  ideas: null,
  picked: {},
};

const sessions = new Map<string, WordingSession>();
const listeners = new Set<() => void>();

export const wordingSessionOf = (projectId: string): WordingSession => sessions.get(projectId) ?? EMPTY;

export const subscribeWordingSessions = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const patchWordingSession = (
  projectId: string,
  recipe: (current: WordingSession) => Partial<WordingSession>,
): void => {
  const current = wordingSessionOf(projectId);
  sessions.set(projectId, { ...current, ...recipe(current) });
  for (const listener of listeners) listener();
};
