import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BrowserProvider, Contract, Eip1193Provider, JsonRpcSigner, ethers } from "ethers";
import { useFhevm, type FhevmGoState, type FhevmDetailedStatus } from "../fhevm/useFhevm";
import { FhevmDecryptionSignature } from "../fhevm/FhevmDecryptionSignature";
import { GenericStringInMemoryStorage } from "../fhevm/GenericStringStorage";
import { RatingNetABI } from "../abi/RatingNetABI";
import { RatingNetAddresses } from "../abi/RatingNetAddresses";

type ChainInfo = {
  chainId?: number;
  address?: `0x${string}`;
  name?: string;
};

function getContractMeta(chainId?: number): { address?: `0x${string}`; abi: typeof RatingNetABI.abi } {
  const entry = chainId ? (RatingNetAddresses[chainId.toString() as keyof typeof RatingNetAddresses] as any) : undefined;
  const address: `0x${string}` | undefined =
    entry && entry.address && entry.address !== ethers.ZeroAddress ? (entry.address as `0x${string}`) : undefined;
  return { address, abi: RatingNetABI.abi };
}

function isEip1193(p: unknown): p is Eip1193Provider {
  return !!p && typeof p === "object" && "request" in (p as any);
}

// Get human-readable status text for UI display
function getStatusText(status: FhevmDetailedStatus): string {
  const statusMap: Record<FhevmDetailedStatus, string> = {
    "idle": "Initializing",
    "sdk-loading": "Loading encryption SDK",
    "sdk-loaded": "SDK ready",
    "sdk-initializing": "Setting up encryption",
    "sdk-initialized": "Encryption configured",
    "creating": "Creating secure instance",
    "ready": "Ready",
    "error": "Connection failed",
  };
  return statusMap[status] || status;
}

function StatusBadge({ status }: { status: FhevmGoState }) {
  const config = {
    idle: { bg: "#f5f5f5", text: "#616161", label: "Initializing" },
    loading: { bg: "#fff3e0", text: "#e65100", label: "Loading" },
    ready: { bg: "#e8f5e9", text: "#2e7d32", label: "Connected" },
    error: { bg: "#ffebee", text: "#c62828", label: "Error" },
  };
  const { bg, text, label } = config[status] || config.idle;
  
  return (
    <span
      style={{
        display: "inline-block",
        padding: "4px 12px",
        borderRadius: "12px",
        backgroundColor: bg,
        color: text,
        fontSize: "13px",
        fontWeight: "600",
      }}
    >
      {label}
    </span>
  );
}

export function App() {
  const [provider, setProvider] = useState<BrowserProvider | undefined>(undefined);
  const [signer, setSigner] = useState<JsonRpcSigner | undefined>(undefined);
  const [chain, setChain] = useState<ChainInfo>({});
  const [status, setStatus] = useState<string>("");
  const [target, setTarget] = useState<string>("");
  const [score, setScore] = useState<number>(5);
  const [avgHandle, setAvgHandle] = useState<string | undefined>(undefined);
  const [avgClear, setAvgClear] = useState<bigint | undefined>(undefined);
  const storage = useMemo(() => new GenericStringInMemoryStorage(), []);

  useEffect(() => {
    const init = async () => {
      if (!("ethereum" in window)) {
        setStatus("Please install MetaMask.");
        return;
      }
      const eth = (window as any).ethereum;
      if (!isEip1193(eth)) {
        setStatus("Invalid EIP-1193 provider.");
        return;
      }
      const _provider = new BrowserProvider(eth);
      setProvider(_provider);
      const network = await _provider.getNetwork();
      setChain({ chainId: Number(network.chainId) });
      const _signer = await _provider.getSigner();
      setSigner(_signer);
    };
    init().catch((e) => setStatus(`Init error: ${e}`));
  }, []);

  const sameChain = useRef<(c?: number) => boolean>(() => true);
  sameChain.current = (cid?: number) => cid === chain.chainId;
  const sameSigner = useRef<(s?: JsonRpcSigner) => boolean>(() => true);
  sameSigner.current = (s?: JsonRpcSigner) => s?.address === signer?.address;

  const fhevm = useFhevm({
    provider: (typeof window !== "undefined" && "ethereum" in window && isEip1193((window as any).ethereum))
      ? ((window as any).ethereum as Eip1193Provider)
      : undefined,
    chainId: chain.chainId,
    enabled: Boolean(provider && chain.chainId),
    initialMockChains: { 31337: "http://127.0.0.1:8545" }
  });

  const contractMeta = useMemo(() => getContractMeta(chain.chainId), [chain.chainId]);

  const canSubmit = useMemo(() => {
    return Boolean(
      fhevm.instance &&
      signer &&
      provider &&
      contractMeta.address &&
      score >= 1 &&
      score <= 5 &&
      ethers.isAddress(target)
    );
  }, [fhevm.instance, signer, provider, contractMeta.address, score, target]);

  const canGetAvg = useMemo(() => {
    return Boolean(fhevm.instance && signer && provider && contractMeta.address && ethers.isAddress(target));
  }, [fhevm.instance, signer, provider, contractMeta.address, target]);

  const submit = useCallback(async () => {
    if (!canSubmit || !fhevm.instance || !signer || !contractMeta.address) return;
    setStatus("Encrypting your rating...");
    try {
      const input = fhevm.instance.createEncryptedInput(contractMeta.address, signer.address as `0x${string}`);
      input.add8(BigInt(score));
      const enc = await input.encrypt();
      setStatus("Submitting encrypted rating to blockchain...");
      const contract = new Contract(contractMeta.address, contractMeta.abi, signer);
      const tx = await contract.submitEncryptedScore(target, enc.handles[0], enc.inputProof);
      await tx.wait();
      setStatus("Rating submitted successfully!");
    } catch (e) {
      setStatus(`Failed to submit rating: ${String(e)}`);
    }
  }, [canSubmit, fhevm.instance, signer, contractMeta.address, score, target]);

  const getAverage = useCallback(async () => {
    if (!canGetAvg || !fhevm.instance || !signer || !contractMeta.address) return;
    setStatus("Preparing to retrieve average rating...");
    try {
      // Ensure wallet is connected/authorized
      try {
        if (provider && typeof (provider as any).send === "function") {
          setStatus("Requesting wallet access...");
          await (provider as any).send("eth_requestAccounts", []);
        }
        await signer.getAddress();
      } catch (authErr) {
        throw new Error(`Wallet connection required: ${String(authErr)}`);
      }

      const contractRW = new Contract(contractMeta.address, contractMeta.abi, signer);

      // Step 1: Send tx to grant decrypt permission to msg.sender
      setStatus("Granting decryption permission on blockchain...");
      const tx = await contractRW.getEncryptedAverage(target);
      await tx.wait();

      // Step 2: Fetch handle via staticCall with signer (no tx)
      setStatus("Retrieving encrypted average...");
      const handle: string = await (contractRW as any).getEncryptedAverage.staticCall(target);
      setAvgHandle(handle);

      // Step 3: Sign EIP-712 permit and decrypt
      setStatus("Requesting signature for decryption...");
      const sig = await FhevmDecryptionSignature.loadOrSign(
        fhevm.instance,
        [contractMeta.address],
        signer,
        storage
      );
      if (!sig) {
        setStatus("Signature creation failed. Please try again.");
        return;
      }
      setStatus("Decrypting average rating...");
      const res = await fhevm.instance.userDecrypt(
        [{ handle, contractAddress: contractMeta.address }],
        sig.privateKey,
        sig.publicKey,
        sig.signature,
        sig.contractAddresses,
        sig.userAddress,
        sig.startTimestamp,
        sig.durationDays
      );
      // Cast to a string-keyed map to safely access by dynamic handle
      const clearValues = res as unknown as Record<string, bigint>;
      const value = clearValues[handle];
      setAvgClear(value);
      setStatus("Average rating decrypted successfully!");
    } catch (e) {
      setStatus(`Failed to retrieve average: ${String(e)}`);
    }
  }, [canGetAvg, fhevm.instance, signer, contractMeta.address, target, storage, provider]);

  return (
    <div style={{ 
      minHeight: "100vh", 
      backgroundColor: "#ffffff",
      fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif"
    }}>
      <div style={{ 
        maxWidth: "1200px", 
        margin: "0 auto", 
        padding: "40px 24px" 
      }}>
        {/* Header */}
        <header style={{ marginBottom: "48px" }}>
          <h1 style={{ 
            fontSize: "42px", 
            fontWeight: "700", 
            color: "#1a1a1a", 
            margin: "0 0 12px 0",
            letterSpacing: "-0.5px"
          }}>
            RatingNet
          </h1>
          <p style={{ 
            fontSize: "18px", 
            color: "#666666", 
            margin: 0,
            fontWeight: "400"
          }}>
            Anonymous encrypted rating system powered by FHEVM
          </p>
        </header>

        {/* Connection Info Card */}
        <div style={{ 
          backgroundColor: "#fafafa", 
          border: "1px solid #e0e0e0",
          borderRadius: "12px", 
          padding: "24px",
          marginBottom: "32px"
        }}>
          <div style={{ 
            display: "grid", 
            gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))", 
            gap: "20px",
            marginBottom: "20px"
          }}>
            <div>
              <div style={{ fontSize: "13px", color: "#757575", marginBottom: "6px", fontWeight: "500" }}>
                Network
              </div>
              <div style={{ fontSize: "15px", color: "#1a1a1a", fontFamily: "monospace" }}>
                {chain.chainId ? `Chain ID: ${chain.chainId}` : "Not connected"}
              </div>
            </div>
            <div>
              <div style={{ fontSize: "13px", color: "#757575", marginBottom: "6px", fontWeight: "500" }}>
                Contract Address
              </div>
              <div style={{ 
                fontSize: "13px", 
                color: "#1a1a1a", 
                fontFamily: "monospace",
                wordBreak: "break-all"
              }}>
                {contractMeta.address || "Not deployed"}
              </div>
            </div>
            <div>
              <div style={{ fontSize: "13px", color: "#757575", marginBottom: "6px", fontWeight: "500" }}>
                Wallet
              </div>
              <div style={{ 
                fontSize: "13px", 
                color: "#1a1a1a", 
                fontFamily: "monospace",
                wordBreak: "break-all"
              }}>
                {signer?.address || "Not connected"}
              </div>
            </div>
          </div>
          
          <div style={{ 
            paddingTop: "20px", 
            borderTop: "1px solid #e0e0e0",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexWrap: "wrap",
            gap: "12px"
          }}>
            <div>
              <div style={{ fontSize: "13px", color: "#757575", marginBottom: "6px", fontWeight: "500" }}>
                Encryption Status
              </div>
              <div style={{ fontSize: "14px", color: "#424242" }}>
                {getStatusText(fhevm.detailedStatus)}
              </div>
            </div>
            <StatusBadge status={fhevm.status} />
          </div>
          {fhevm.error && (
            <div style={{ 
              marginTop: "16px", 
              padding: "12px 16px",
              backgroundColor: "#ffebee",
              border: "1px solid #ef9a9a",
              borderRadius: "8px",
              color: "#c62828",
              fontSize: "14px"
            }}>
              <strong>Error:</strong> {fhevm.error.message}
            </div>
          )}
        </div>

        {/* Main Content - Two Column Layout */}
        <div style={{ 
          display: "grid", 
          gridTemplateColumns: "1fr 1fr",
          gap: "24px",
          marginBottom: "32px"
        }}>
          {/* Submit Rating Card */}
          <div style={{ 
            backgroundColor: "#fafafa",
            border: "1px solid #e0e0e0",
            borderRadius: "12px",
            padding: "32px"
          }}>
            <h2 style={{ 
              fontSize: "22px", 
              fontWeight: "600", 
              color: "#1a1a1a", 
              margin: "0 0 24px 0" 
            }}>
              Submit Rating
            </h2>
            
            <div style={{ marginBottom: "24px" }}>
              <label style={{ 
                display: "block", 
                fontSize: "14px", 
                fontWeight: "500", 
                color: "#424242",
                marginBottom: "8px"
              }}>
                Target Address
              </label>
              <input
                value={target}
                onChange={(e) => setTarget(e.target.value)}
                placeholder="0x..."
                style={{ 
                  width: "100%",
                  padding: "12px 16px",
                  fontSize: "14px",
                  border: "1px solid #bdbdbd",
                  borderRadius: "8px",
                  fontFamily: "monospace",
                  color: "#1a1a1a",
                  backgroundColor: "#ffffff",
                  boxSizing: "border-box",
                  outline: "none"
                }}
                onFocus={(e) => e.target.style.borderColor = "#2196f3"}
                onBlur={(e) => e.target.style.borderColor = "#bdbdbd"}
              />
            </div>

            <div style={{ marginBottom: "28px" }}>
              <label style={{ 
                display: "block", 
                fontSize: "14px", 
                fontWeight: "500", 
                color: "#424242",
                marginBottom: "12px"
              }}>
                Rating Score
              </label>
              <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                {[1, 2, 3, 4, 5].map((val) => (
                  <button
                    key={val}
                    onClick={() => setScore(val)}
                    style={{
                      width: "48px",
                      height: "48px",
                      borderRadius: "8px",
                      border: score === val ? "2px solid #2196f3" : "1px solid #bdbdbd",
                      backgroundColor: score === val ? "#e3f2fd" : "#ffffff",
                      color: score === val ? "#1976d2" : "#616161",
                      fontSize: "18px",
                      fontWeight: "600",
                      cursor: "pointer",
                      transition: "all 0.2s"
                    }}
                  >
                    {val}
                  </button>
                ))}
              </div>
            </div>

            <button 
              disabled={!canSubmit} 
              onClick={submit}
              style={{
                width: "100%",
                padding: "14px 24px",
                fontSize: "15px",
                fontWeight: "600",
                color: "#ffffff",
                backgroundColor: canSubmit ? "#2196f3" : "#bdbdbd",
                border: "none",
                borderRadius: "8px",
                cursor: canSubmit ? "pointer" : "not-allowed",
                transition: "all 0.2s"
              }}
            >
              Submit Encrypted Rating
            </button>
          </div>

          {/* Get Average Card */}
          <div style={{ 
            backgroundColor: "#fafafa",
            border: "1px solid #e0e0e0",
            borderRadius: "12px",
            padding: "32px"
          }}>
            <h2 style={{ 
              fontSize: "22px", 
              fontWeight: "600", 
              color: "#1a1a1a", 
              margin: "0 0 24px 0" 
            }}>
              View Average Rating
            </h2>
            
            <div style={{ marginBottom: "24px" }}>
              <label style={{ 
                display: "block", 
                fontSize: "14px", 
                fontWeight: "500", 
                color: "#424242",
                marginBottom: "8px"
              }}>
                Target Address
              </label>
              <input
                value={target}
                onChange={(e) => setTarget(e.target.value)}
                placeholder="0x..."
                style={{ 
                  width: "100%",
                  padding: "12px 16px",
                  fontSize: "14px",
                  border: "1px solid #bdbdbd",
                  borderRadius: "8px",
                  fontFamily: "monospace",
                  color: "#1a1a1a",
                  backgroundColor: "#ffffff",
                  boxSizing: "border-box",
                  outline: "none"
                }}
                onFocus={(e) => e.target.style.borderColor = "#4caf50"}
                onBlur={(e) => e.target.style.borderColor = "#bdbdbd"}
              />
            </div>

            <button 
              disabled={!canGetAvg} 
              onClick={getAverage}
              style={{
                width: "100%",
                padding: "14px 24px",
                fontSize: "15px",
                fontWeight: "600",
                color: "#ffffff",
                backgroundColor: canGetAvg ? "#4caf50" : "#bdbdbd",
                border: "none",
                borderRadius: "8px",
                cursor: canGetAvg ? "pointer" : "not-allowed",
                transition: "all 0.2s",
                marginBottom: "24px"
              }}
            >
              Decrypt Average Rating
            </button>

            {avgClear !== undefined && (
              <div style={{ 
                padding: "20px",
                backgroundColor: "#e8f5e9",
                border: "1px solid #a5d6a7",
                borderRadius: "8px",
                textAlign: "center"
              }}>
                <div style={{ fontSize: "13px", color: "#2e7d32", fontWeight: "500", marginBottom: "8px" }}>
                  Average Rating
                </div>
                <div style={{ fontSize: "36px", fontWeight: "700", color: "#1b5e20" }}>
                  {(Number(avgClear) / 100).toFixed(2)}
                </div>
                <div style={{ fontSize: "12px", color: "#558b2f", marginTop: "4px" }}>
                  out of 5.00
                </div>
              </div>
            )}

            {avgHandle && (
              <div style={{ 
                marginTop: "16px",
                padding: "12px",
                backgroundColor: "#ffffff",
                border: "1px solid #e0e0e0",
                borderRadius: "8px"
              }}>
                <div style={{ fontSize: "12px", color: "#757575", marginBottom: "6px", fontWeight: "500" }}>
                  Encrypted Handle
                </div>
                <div style={{ 
                  fontSize: "11px", 
                  color: "#424242", 
                  fontFamily: "monospace",
                  wordBreak: "break-all"
                }}>
                  {avgHandle}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Status Message */}
        {status && (
          <div style={{ 
            padding: "16px 20px",
            backgroundColor: "#f5f5f5",
            border: "1px solid #e0e0e0",
            borderRadius: "8px",
            marginBottom: "32px"
          }}>
            <div style={{ 
              fontSize: "14px", 
              color: "#424242",
              display: "flex",
              alignItems: "center",
              gap: "8px"
            }}>
              <span style={{ fontSize: "16px" }}>ℹ️</span>
              {status}
            </div>
          </div>
        )}

        {/* Info Section */}
        <div style={{ 
          padding: "24px",
          backgroundColor: "#fafafa",
          border: "1px solid #e0e0e0",
          borderRadius: "12px"
        }}>
          <h3 style={{ 
            fontSize: "16px", 
            fontWeight: "600", 
            color: "#1a1a1a", 
            margin: "0 0 12px 0" 
          }}>
            How It Works
          </h3>
          <p style={{ 
            fontSize: "14px", 
            color: "#616161", 
            lineHeight: "1.6",
            margin: 0
          }}>
            RatingNet uses Fully Homomorphic Encryption (FHEVM) to keep ratings completely private. 
            Ratings are encrypted on your device before submission, processed encrypted on-chain, 
            and only decrypted when you choose to view the average. No individual ratings are ever exposed.
          </p>
        </div>
      </div>
    </div>
  );
}


