import { GoogleGenAI } from "@google/genai";
import readlineSync from 'readline-sync';
import { exec } from "child_process";
import { promisify } from "util";
// Node.js's built-in File System library
import fs from 'fs';

const asyncExecute = promisify(exec);
//To save the code your AI creates into real files.
const writeFileAsync = promisify(fs.writeFile);

//Instead Node.js now has a built-in Promises API
// import fs from 'fs/promises';
// await fs.writeFile('filePath.js', content);

const History = [];
const ai = new GoogleGenAI({ apiKey: "Your Gen ai api key" });

async function executeCommand({ command, content, filePath }) {
    try {
        if (content && filePath) {
             await writeFileAsync(filePath, content);
            return `Success: File created at ${filePath}`;
        } else if (command) {
            // Execute regular command
            const { stdout, stderr } = await asyncExecute(command);
            if (stderr) {
                return `Error: ${stderr}`;
            }
            return `Success: ${stdout || 'Command executed successfully'}`;
        }
        return 'Error: No command or content provided';
    } catch (error) {
        return `Error: ${error.message}`;
    }
}

const executeCommandDeclaration = {
    name: "executeCommand",
    description: "Execute commands or create files with content on Windows systems",
    parameters: {
        type: 'OBJECT',
        properties: {
            command: {
                type: 'STRING',
                description: 'A Windows terminal command (e.g., "mkdir my-project")'
            },
            content: {
                type: 'STRING',
                description: 'Complete file content to write (for HTML/CSS/JS files)'
            },
            filePath: {
                type: 'STRING',
                description: 'Path where file should be created (e.g., "my-project/index.html")'
            }
        },
    }
}

const availableTools = {
    executeCommand
}

async function runAgent(userProblem) {
    History.push({
        role: 'user',
        parts: [{ text: userProblem }]
    });

    while (true) {
        try {
            const response = await ai.models.generateContent({
                model: "gemini-2.5-flash",
                contents: History,
                config: {
                    systemInstruction: `You are an expert Website builder. Follow these steps:
                    
                    1. FIRST create the project folder: mkdir project-name
                    2. THEN create files with COMPLETE TEMPLATES:
                       - index.html (with basic HTML5 structure)
                       - style.css (with basic styles)
                       - script.js (with basic functionality)
                    
                    IMPORTANT:
                    - Use the 'content' parameter to send COMPLETE file content
                    - Always include the 'filePath' parameter when writing files
                    - For folders, use the 'command' parameter with mkdir
                    - Include proper DOCTYPE, meta tags, and semantic HTML
                    - Include responsive CSS (viewport meta, flexible units)
                    - Include DOMContentLoaded event in JavaScript
                    
                    EXAMPLE for a calculator:
                    1. {command: "mkdir calculator"}
                    2. {content: "<!DOCTYPE html>...", filePath: "calculator/index.html"}
                    3. {content: "body { font-family: Arial...}", filePath: "calculator/style.css"}
                    4. {content: "document.addEventListener...", filePath: "calculator/script.js"}`,
                    tools: [{
                        functionDeclarations: [executeCommandDeclaration]
                    }],
                },
            });

            if (response.functionCalls && response.functionCalls.length > 0) {
                const { name, args } = response.functionCalls[0];
                
                if (args.content && args.filePath) {
                    console.log(`Creating file: ${args.filePath}`);
                } else if (args.command) {
                    console.log(`Executing command: ${args.command}`);
                }

                const result = await availableTools[name](args);
                console.log(`Result: ${result}`);

                History.push({
                    role: "model",
                    parts: [{
                        functionCall: response.functionCalls[0],
                    }],
                });

                History.push({
                    role: "user",
                    parts: [{
                        functionResponse: {
                            name: name,
                            response: { result },
                        },
                    }],
                });
            } else {
                History.push({
                    role: 'model',
                    parts: [{ text: response.text }]
                });
                console.log(response.text);
                break;
            }
        } catch (error) {
            console.error("Error:", error);
            break;
        }
    }
}

async function main() {
    console.log("🚀 Website Builder - Describe the website you want to create");
    const userProblem = readlineSync.question("Your idea: ");
    await runAgent(userProblem);
    main();
}

main();
