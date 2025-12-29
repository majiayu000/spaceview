import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { ErrorNotificationProvider, SettingsProvider } from "./contexts";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <SettingsProvider>
      <ErrorNotificationProvider autoDismissMs={5000}>
        <App />
      </ErrorNotificationProvider>
    </SettingsProvider>
  </React.StrictMode>
);
