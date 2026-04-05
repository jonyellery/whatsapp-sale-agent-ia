import { useEffect, useRef, useCallback } from 'react';

export function useWorker(workerFactory: () => Worker) {
  const workerRef = useRef<Worker | null>(null);
  const callbacksRef = useRef<Map<string, (result: any) => void>>(new Map());
  const messageIdRef = useRef(0);

  useEffect(() => {
    workerRef.current = workerFactory();

    workerRef.current.onmessage = (e: MessageEvent<any>) => {
      const { id, success, result, error } = e.data;
      if (id && callbacksRef.current.has(id)) {
        const callback = callbacksRef.current.get(id);
        if (callback) {
          if (success) {
            callback(result);
          } else {
            console.error('Worker error:', error);
          }
          callbacksRef.current.delete(id);
        }
      }
    };

    return () => {
      workerRef.current?.terminate();
    };
  }, [workerFactory]);

  const postMessage = useCallback((type: string, data: any): Promise<any> => {
    return new Promise((resolve) => {
      const id = `msg_${++messageIdRef.current}`;
      callbacksRef.current.set(id, resolve);
      workerRef.current?.postMessage({ type, id, data });
    });
  }, []);

  return { postMessage };
}