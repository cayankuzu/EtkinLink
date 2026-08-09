import { useEffect, useRef, useState } from 'react';

export type AvailabilityStatus =
  | 'idle'
  | 'checking'
  | 'available'
  | 'unavailable'
  | 'error';

type AvailabilityResult = {
  value: string;
  status: AvailabilityStatus;
};

export function useAvailabilityCheck({
  value,
  normalize,
  isValid,
  check,
  delay = 350,
}: {
  value: string;
  normalize: (value: string) => string;
  isValid: (value: string) => boolean;
  check: (value: string) => Promise<boolean>;
  delay?: number;
}): AvailabilityStatus {
  const normalized = normalize(value);
  const requestId = useRef(0);
  const [result, setResult] = useState<AvailabilityResult>({
    value: '',
    status: 'idle',
  });

  useEffect(() => {
    requestId.current += 1;
    const activeRequest = requestId.current;
    if (!isValid(normalized)) {
      setResult({ value: normalized, status: 'idle' });
      return;
    }

    setResult({ value: normalized, status: 'checking' });
    const timer = setTimeout(() => {
      void check(normalized)
        .then(available => {
          if (requestId.current !== activeRequest) return;
          setResult({
            value: normalized,
            status: available ? 'available' : 'unavailable',
          });
        })
        .catch(() => {
          if (requestId.current !== activeRequest) return;
          setResult({ value: normalized, status: 'error' });
        });
    }, delay);

    return () => clearTimeout(timer);
  }, [check, delay, isValid, normalize, normalized]);

  if (result.value !== normalized) {
    return isValid(normalized) ? 'checking' : 'idle';
  }
  return result.status;
}
