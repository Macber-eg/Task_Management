// Must stay first: it pins the time zone and points the app at the test
// database before any module reads the environment or creates a Date.
import "./test-env";
import "reflect-metadata";
