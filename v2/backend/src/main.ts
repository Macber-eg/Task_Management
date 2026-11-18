import "./config/load-env";
import "reflect-metadata";
import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { AppModule } from "./app.module";
import { ApiExpressAdapter } from "./common/http/api-express-adapter";
import { validateEnv } from "./config/validate-env";
import { configureApp } from "./configure-app";

async function bootstrap() {
  validateEnv();

  const app = await NestFactory.create<NestExpressApplication>(
    AppModule,
    new ApiExpressAdapter(),
    // The app registers its own JSON parser (size limit, raw body, error shape).
    { bodyParser: false },
  );
  configureApp(app);

  const port = Number(process.env.PORT) || 1337;
  await app.listen(port);
  new Logger("Bootstrap").log(`API listening on port ${port}`);
}

bootstrap().catch((error: unknown) => {
  new Logger("Bootstrap").error("Failed to start", error);
  process.exit(1);
});
