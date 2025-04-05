import React from "react";
import { Link } from "react-router-dom";
import homelogo from "./icons/home.png";
import reportlogo from "./icons/report.png";
import chatbotlogo from "./icons/chatbot.png";
import messageslogo from "./icons/messages.png";
import websitelogo from "./icons/website.png";

const Footer = () => {
  const navItems = [
    { label: "ChatBot", icon: chatbotlogo, path: "/chatbot" },
    { label: "Reports", icon: reportlogo, path: "/reports" },
    { label: "Home", icon: homelogo, path: "/" },
    { label: "Realtime", icon: messageslogo, path: "/realtime" },
    { label: "Website", icon: websitelogo, url: "https://safeweb-livid.vercel.app/" },
  ];

  return (
    <footer className="footer">
      {navItems.map(({ label, icon, path, url }) => (
        url ? (
          <a
            key={label}
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className={`footer-item ${label === "Home" ? "home-item" : ""}`}
          >
            <img src={icon} alt={label} className="footer-icon" />
            <span className="footer-label">{label}</span>
          </a>
        ) : (
          <Link
            key={label}
            to={path}
            className={`footer-item ${label === "Home" ? "home-item" : ""}`}
          >
            <img src={icon} alt={label} className="footer-icon" />
            <span className="footer-label">{label}</span>
          </Link>
        )
      ))}
    </footer>
  );
};

export default Footer;