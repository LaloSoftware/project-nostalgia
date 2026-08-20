// Store reactivo mínimo, sin framework — a propósito: las carátulas dibujan de forma imperativa
// en canvas/WebGL, así que un framework de UI reactiva (React, etc.) no aportaría nada a la
// parte que más importa y sí añadiría acoplamiento al contrato de carátulas.

export interface Store<T> {
  get(): T;
  set(patch: Partial<T>): void;
  subscribe(cb: (value: T) => void): () => void;
}

export function createStore<T extends object>(initial: T): Store<T> {
  let value = initial;
  const listeners = new Set<(value: T) => void>();

  return {
    get() {
      return value;
    },
    set(patch) {
      value = { ...value, ...patch };
      for (const cb of listeners) cb(value);
    },
    subscribe(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
  };
}
