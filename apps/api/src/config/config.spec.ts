import { postgresConnection } from '../db/db.module';
import { loadConfig } from './config';

const env = (REDIS_URL: string) => ({ DATABASE_URL: 'postgres://x', REDIS_URL });

describe('REDIS_URL validation', () => {
  it('accepts local and Upstash TLS URLs', () => {
    expect(() => loadConfig(env('redis://localhost:6379'))).not.toThrow();
    expect(() => loadConfig(env('rediss://default:secret@cosmic-treefrog-217773.upstash.io:6379'))).not.toThrow();
  });

  it('rejects the Upstash REST URL', () => {
    expect(() => loadConfig(env('https://cosmic-treefrog-217773.upstash.io'))).toThrow(/REDIS_URL.*https REST URL/);
  });

  it('rejects a non-TLS Upstash URL', () => {
    expect(() => loadConfig(env('redis://default:secret@cosmic-treefrog-217773.upstash.io:6379'))).toThrow(
      /rediss:\/\//,
    );
  });
});

describe('postgresConnection', () => {
  it('turns sslmode=require into explicit, verified TLS', () => {
    const { connectionString, ssl } = postgresConnection(
      'postgresql://u:p@ep-x.eu-central-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require',
    );
    expect(connectionString).toBe('postgresql://u:p@ep-x.eu-central-1.aws.neon.tech/neondb?channel_binding=require');
    expect(ssl).toEqual({ rejectUnauthorized: true });
  });

  it('leaves local URLs without TLS', () => {
    expect(postgresConnection('postgres://docs:docs@localhost:5432/docs_assistant')).toEqual({
      connectionString: 'postgres://docs:docs@localhost:5432/docs_assistant',
    });
  });
});
