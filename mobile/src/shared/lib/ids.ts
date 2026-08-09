import { v4 as uuid } from 'uuid';

export function createClientId(): string {
  return uuid();
}
