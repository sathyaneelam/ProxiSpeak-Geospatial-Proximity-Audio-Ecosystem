
const helmet = require("helmet");
const express = require("express");
const cors = require("cors");
const session = require("express-session");
const MongoStore = require("connect-mongo").default;

const userRoutes = require("./routes/userRoutes");
const positionRoutes = require("./routes/positionRoutes");
const officeRoutes = require("./routes/officeRoutes");
const authRoutes = require("./routes/authRoutes");

const errorHandler = require("./middleware/errorHandler");
const validateJson = require("./middleware/validateJson");

const app = express();
app.set("trust proxy", 1);
app.use(helmet());

const allowedOrigins = [
  "http://localhost:5173",
  "https://proxispeak-frontend.onrender.com",
  ...(process.env.FRONTEND_ORIGIN || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
];

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin)) {
        return callback(null, true);
      }

      return callback(new Error("Origin not allowed by CORS"));
    },
    credentials: true,
  })
);

app.use(express.json());

// Create the MongoDB session store separately so it can be closed.
const sessionStore = MongoStore.create({
  mongoUrl: process.env.MONGODB_URI,
  dbName: "ProxiSpeak",
  collectionName: "sessions",
  ttl: 24 * 60 * 60,
});

// Make the store available to the test cleanup hook.
app.locals.sessionStore = sessionStore;

app.use(
  session({
    name: "proxispeak.sid",
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    store: sessionStore,
    cookie: {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite:
        process.env.NODE_ENV === "production" ? "none" : "lax",
      maxAge: 24 * 60 * 60 * 1000,
    },
  })
);

app.use(validateJson);

app.get("/", (req, res) => {
  res.json({
    project: "ProxiSpeak",
    message: "Backend API is running successfully",
    status: "success",
  });
});

app.get("/health", (req, res) => {
  res.status(200).json({
    status: "OK",
    message: "ProxiSpeak server is healthy",
  });
});

app.use("/api/users", userRoutes);
app.use("/api/positions", positionRoutes);
app.use("/api/offices", officeRoutes);
app.use("/api/auth", authRoutes);

app.use((req, res, next) => {
  const error = new Error("Route not found");
  error.status = 404;
  next(error);
});

app.use(errorHandler);

module.exports = app;
