import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Paths
const backendDeploymentsDir = resolve(__dirname, "../../backend/deployments");
const frontendAbiDir = resolve(__dirname, "../src/abi");

// Ensure output dir exists
if (!existsSync(frontendAbiDir)) {
  mkdirSync(frontendAbiDir, { recursive: true });
}

// Network priority order (sepolia first, then local networks)
const networkPriority = ["sepolia", "hardhat", "localhost", "anvil"];

// Chain ID to network name mapping
const chainIdToName = {
  11155111: "sepolia",
  31337: "localhost"
};

// Scan for all deployments
async function scanDeployments() {
  const fs = await import("fs/promises");
  const deployments = new Map();
  let firstDeployment = null;

  // Check priority networks first
  for (const net of networkPriority) {
    const p = resolve(backendDeploymentsDir, net, "RatingNet.json");
    if (existsSync(p)) {
      try {
        const deployment = JSON.parse(readFileSync(p, "utf-8"));
        const { address, abi, chainId } = deployment;
        const chainIdStr = String(chainId ?? (net === "sepolia" ? 11155111 : 31337));
        
        if (!firstDeployment) {
          firstDeployment = { abi, chainId: chainIdStr };
        }
        
        deployments.set(chainIdStr, {
          address,
          chainId: parseInt(chainIdStr),
          chainName: chainIdToName[parseInt(chainIdStr)] || net
        });
        console.log(`Found deployment on ${net} (chainId: ${chainIdStr})`);
      } catch (err) {
        console.warn(`Failed to read deployment from ${net}:`, err.message);
      }
    }
  }

  // Scan for any other network folders
  try {
    const entries = await fs.readdir(backendDeploymentsDir, { withFileTypes: true });
    for (const e of entries) {
      if (e.isDirectory() && !networkPriority.includes(e.name)) {
        const p = resolve(backendDeploymentsDir, e.name, "RatingNet.json");
        if (existsSync(p)) {
          try {
            const deployment = JSON.parse(readFileSync(p, "utf-8"));
            const { address, abi, chainId } = deployment;
            const chainIdStr = String(chainId ?? 31337);
            
            if (!firstDeployment) {
              firstDeployment = { abi, chainId: chainIdStr };
            }
            
            if (!deployments.has(chainIdStr)) {
              deployments.set(chainIdStr, {
                address,
                chainId: parseInt(chainIdStr),
                chainName: chainIdToName[parseInt(chainIdStr)] || e.name
              });
              console.log(`Found deployment on ${e.name} (chainId: ${chainIdStr})`);
            }
          } catch (err) {
            console.warn(`Failed to read deployment from ${e.name}:`, err.message);
          }
        }
      }
    }
  } catch (err) {
    console.warn(`Failed to scan deployments directory:`, err.message);
  }

  return { deployments, firstDeployment };
}

// Main execution
const { deployments, firstDeployment } = await scanDeployments();

if (!firstDeployment) {
  console.warn("No deployments found. Skipping ABI generation.");
  console.log("Deploy contracts first, then run npm run genabi.");
  process.exit(0);
}

// Write ABI (use first deployment's ABI)
const abiOut = resolve(frontendAbiDir, "RatingNetABI.ts");
writeFileSync(
  abiOut,
  `export const RatingNetABI = ${JSON.stringify({ abi: firstDeployment.abi }, null, 2)} as const;\n`,
  "utf-8"
);
console.log(`Generated ${abiOut}`);

// Write addresses (include all found deployments)
const addrOut = resolve(frontendAbiDir, "RatingNetAddresses.ts");
const addresses = Object.fromEntries(deployments);
writeFileSync(
  addrOut,
  `export const RatingNetAddresses = ${JSON.stringify(addresses, null, 2)} as const;\n`,
  "utf-8"
);
console.log(`Generated ${addrOut} with ${deployments.size} network(s):`);
for (const [chainId, info] of deployments.entries()) {
  console.log(`  - Chain ${chainId} (${info.chainName}): ${info.address}`);
}
