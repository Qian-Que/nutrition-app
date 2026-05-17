import cors from "cors";
import express from "express";
import helmet from "helmet";
import morgan from "morgan";

import { config } from "./config";
import { errorHandler, notFoundHandler } from "./middleware/error";
import { authRouter } from "./routes/auth";
import { classifierRouter } from "./routes/classifier";
import { exercisesRouter } from "./routes/exercises";
import { feedRouter } from "./routes/feed";
import { friendsRouter } from "./routes/friends";
import { groupsRouter } from "./routes/groups";
import { logsRouter } from "./routes/logs";
import { nutritionRouter } from "./routes/nutrition";
import { profileRouter } from "./routes/profile";
import { weightsRouter } from "./routes/weights";

const app = express();

app.use(helmet());
app.use(cors({ origin: config.corsOrigin }));
app.use(morgan("dev"));
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "nutrition-server" });
});

app.use("/api/auth", authRouter);
app.use("/api/profile", profileRouter);
app.use("/api/classifier", classifierRouter);
app.use("/api/nutrition", nutritionRouter);
app.use("/api/logs", logsRouter);
app.use("/api/exercises", exercisesRouter);
app.use("/api/weights", weightsRouter);
app.use("/api/friends", friendsRouter);
app.use("/api/groups", groupsRouter);
app.use("/api/feed", feedRouter);

app.use(notFoundHandler);
app.use(errorHandler);

app.listen(config.port, () => {
  console.log(`Server running on http://localhost:${config.port}`);
});

