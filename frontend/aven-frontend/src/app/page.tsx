"use client";
import { useRef, useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import Vapi from '@vapi-ai/web';

// Define the Message type
type Message = {
  role: "user" | "assistant";
  content: string;
  sources?: string[];
};

export default function Home() {
  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="text-center">
        <h1 className="text-4xl font-bold text-gray-900 mb-4">Demo Site</h1>
        <p className="text-lg text-gray-600">Welcome to the Aven demo site</p>
      </div>
    </div>
  );
}
