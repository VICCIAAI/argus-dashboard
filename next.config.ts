import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The swipe page is meant for a phone on the home Wi-Fi, which loads the
  // dev server by the laptop's LAN address rather than localhost.
  allowedDevOrigins: ["10.0.0.239", "*.local"],
};

export default nextConfig;
