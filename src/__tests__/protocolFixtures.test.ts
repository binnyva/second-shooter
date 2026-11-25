import { readFileSync } from 'fs';
import { join } from 'path';
import {
  COMMAND_TYPES,
  RESPONSE_TYPES,
  type Command,
  type Response,
} from '../../shared/protocol';

// shared/protocol-fixtures.json is read by the Kotlin app's tests too
// (native-android ProtocolFixturesTest), which decode and re-encode every
// example. This side makes sure the file covers the whole protocol.
const fixtures = JSON.parse(
  readFileSync(join(__dirname, '../../shared/protocol-fixtures.json'), 'utf8')
) as { commands: Command[]; responses: Response[] };

describe('shared/protocol-fixtures.json', () => {
  it('has an example of every command type', () => {
    expect(new Set(fixtures.commands.map((c) => c.type))).toEqual(new Set(COMMAND_TYPES));
  });

  it('has an example of every response type', () => {
    expect(new Set(fixtures.responses.map((r) => r.type))).toEqual(new Set(RESPONSE_TYPES));
  });
});
