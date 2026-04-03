import React from "react";
import ReactDOM from "react-dom/client";
import "leaflet/dist/leaflet.css";
import App from "./App.jsx";
import QuotePage from "./QuotePage.jsx";
import "./styles.css";

const rootComponent = window.location.pathname.startsWith("/quote/") ? <QuotePage /> : <App />;

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    {rootComponent}
  </React.StrictMode>,
);
