import 'dotenv/config';
import { z } from 'zod';

const bool = (def: boolean) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined ? def : /^(1|true|yes|on)$/i.test(v)));

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  CORS_ORIGINS: z
    .string()
    .default('http://localhost:5173')
    .transform((v) =>
      v
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    ),

  MYSQL_HOST: z.string().default('localhost'),
  MYSQL_PORT: z.coerce.number().int().positive().default(3306),
  MYSQL_USER: z.string().min(1),
  MYSQL_PASSWORD: z.string().default(''),
  MYSQL_DATABASE: z.string().min(1),
  MYSQL_CONNECTION_LIMIT: z.coerce.number().int().positive().default(10),

  // Optional in P1/P2; required once interface secret encryption (P3) is enabled.
  INTERFACE_SECRET_KEY: z.string().optional(),

  AIRFLOW_BASE_URL: z.string().url().optional(),
  AIRFLOW_USERNAME: z.string().optional(),
  AIRFLOW_PASSWORD: z.string().optional(),
  AIRFLOW_DAG_ID: z.string().default('invoice_execution_dag'),

  // --- Direct pipeline trigger (Reprocess button) ---
  // Spawns `PIPELINE_PYTHON_EXECUTABLE process_invoices.py --interface-id <id>
  // --ap-batch-name <name>` in PIPELINE_SCRIPTS_DIR. Kept separate from the
  // Airflow trigger above (still unimplemented) -- this is a direct
  // child_process.spawn(), always with an argv array, never a shell string.
  PIPELINE_PYTHON_EXECUTABLE: z.string().default('python'),
  PIPELINE_SCRIPTS_DIR: z.string().default('../../scripts'),
  // How long to wait for the triggered run's ap_run_log row to appear before
  // giving up on the request (the run itself keeps going in the background
  // either way -- this only bounds how long the HTTP request waits).
  PIPELINE_TRIGGER_POLL_TIMEOUT_MS: z.coerce.number().int().positive().default(15_000),

  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace'])
    .default('info'),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  // eslint-disable-next-line no-console
  console.error(
    'Invalid environment configuration:\n' +
      parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n'),
  );
  process.exit(1);
}

export const env = parsed.data;
export type Env = typeof env;

export const isProd = env.NODE_ENV === 'production';
