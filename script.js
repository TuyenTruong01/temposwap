// script.js (Vite module)
import { ethers } from "ethers";

(function () {
  const CFG = window.APP_CONFIG;
  if (!CFG) {
    alert("Missing APP_CONFIG. Check /public/config.js loaded before script.js");
    return;
  }

  // ===== DOM =====
  const networkNameEl = document.getElementById("networkName");
  const btnConnectTop = document.getElementById("btnConnectTop");
  const btnDisconnect = document.getElementById("btnDisconnect");
  const btnReset = document.getElementById("btnReset");

  const walletStatusEl = document.getElementById("walletStatus");
  const balancesLineEl = document.getElementById("balancesLine");

  const tabSwap = document.getElementById("tabSwap");
  const tabLiquidity = document.getElementById("tabLiquidity");
  const tabFaucet = document.getElementById("tabFaucet");

  const panelSwap = document.getElementById("panelSwap");
  const panelLiquidity = document.getElementById("panelLiquidity");
  const panelFaucet = document.getElementById("panelFaucet");

  const fromAmountEl = document.getElementById("fromAmount");
  const toAmountEl = document.getElementById("toAmount");
  const fromBalEl = document.getElementById("fromBal");
  const toBalEl = document.getElementById("toBal");
  const rateLineEl = document.getElementById("rateLine");
  const slippageSel = document.getElementById("slippageSel");
  const btnFlip = document.getElementById("btnFlip");
  const btnSwap = document.getElementById("btnSwap");
  const swapMsg = document.getElementById("swapMsg");

  const btnClaimBoth = document.getElementById("btnClaimBoth");
  const faucetMsg = document.getElementById("faucetMsg");

  // Liquidity DOM
  const liqHouseAmountEl = document.getElementById("liqHouseAmount");
  const liqBicyAmountEl = document.getElementById("liqBicyAmount");
  const liqHouseBalEl = document.getElementById("liqHouseBal");
  const liqBicyBalEl = document.getElementById("liqBicyBal");
  const btnAddLiquidity = document.getElementById("btnAddLiquidity");
  const liqMsg = document.getElementById("liqMsg");
  const liqRatioEl = document.getElementById("liqRatio");
  const liqPreviewEl = document.getElementById("liqPreview");

  // ===== State =====
  let provider = null;
  let signer = null;
  let account = null;

  let erc20Abi = null;
  let faucetAbi = null;
  let ammAbi = null;

  let house = null;
  let bicy = null;
  let faucet = null;
  let amm = null;

  let houseDec = 18;
  let bicyDec = 18;

  let fromToken = "HOUSE";
  let toToken = "BICY";

  // liquidity input sync
  let liqLastEdited = "HOUSE"; // "HOUSE" | "BICY"
  let liqIsSyncing = false;

  // ===== Helpers =====
  const setMsg = (el, text) => (el.textContent = text || "");
  const shortAddr = (a) => (a ? a.slice(0, 6) + "…" + a.slice(-4) : "");

  function trimNum(x) {
    const n = Number(x);
    if (!isFinite(n)) return "0";
    if (n === 0) return "0";
    if (Math.abs(n) < 0.0001) return n.toExponential(2);
    return n.toLocaleString(undefined, { maximumFractionDigits: 6 });
  }

  async function fetchJson(path) {
    const r = await fetch(path, { cache: "no-store" });
    if (!r.ok) throw new Error(`Fetch failed ${path}: ${r.status}`);
    return await r.json();
  }

  async function ensureChain() {
    const eth = window.ethereum;
    if (!eth) throw new Error("No injected wallet found (window.ethereum missing).");

    const target = String(CFG.chain.chainIdHex || "").toLowerCase();
    if (!target) throw new Error("Missing CFG.chain.chainIdHex in public/config.js");

    const cur = String(await eth.request({ method: "eth_chainId" })).toLowerCase();
    if (cur === target) return;

    try {
      await eth.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: CFG.chain.chainIdHex }]
      });
    } catch (e) {
      if (e?.code === 4902 || String(e?.message || "").toLowerCase().includes("unrecognized")) {
        await eth.request({
          method: "wallet_addEthereumChain",
          params: [{
            chainId: CFG.chain.chainIdHex,
            chainName: CFG.chain.chainName,
            rpcUrls: CFG.chain.rpcUrls,
            nativeCurrency: CFG.chain.nativeCurrency,
            blockExplorerUrls: CFG.chain.blockExplorerUrls
          }]
        });
      } else {
        throw e;
      }
    }
  }

  async function loadAbisOnce() {
    if (erc20Abi && faucetAbi && ammAbi) return;
    [erc20Abi, faucetAbi, ammAbi] = await Promise.all([
      fetchJson(CFG.abi.erc20),
      fetchJson(CFG.abi.faucet),
      fetchJson(CFG.abi.amm),
    ]);
  }

  function makeContracts() {
    if (!provider) return;
    const conn = signer || provider;

    house = new ethers.Contract(CFG.contracts.HOUSE, erc20Abi, conn);
    bicy = new ethers.Contract(CFG.contracts.BICY, erc20Abi, conn);
    faucet = new ethers.Contract(CFG.contracts.FAUCET, faucetAbi, conn);
    amm = new ethers.Contract(CFG.contracts.AMM, ammAbi, conn);
  }

  function setConnectedUI(yes) {
    btnConnectTop.textContent = yes ? "Connected" : "Connect Wallet";
    if (btnDisconnect) btnDisconnect.style.display = yes ? "inline-flex" : "none";
  }

  function setTab(which) {
    const isSwap = which === "swap";
    const isLiq = which === "liq";
    const isFaucet = which === "faucet";

    tabSwap.classList.toggle("tab--active", isSwap);
    tabLiquidity.classList.toggle("tab--active", isLiq);
    tabFaucet.classList.toggle("tab--active", isFaucet);

    panelSwap.classList.toggle("hidden", !isSwap);
    panelLiquidity.classList.toggle("hidden", !isLiq);
    panelFaucet.classList.toggle("hidden", !isFaucet);

    setMsg(swapMsg, "");
    setMsg(liqMsg, "");
    setMsg(faucetMsg, "");
  }

  async function refreshBalances() {
    if (!provider || !account || !house || !bicy) {
      balancesLineEl.textContent = "HOUSE: 0 | BICY: 0";
      fromBalEl.textContent = "0";
      toBalEl.textContent = "0";
      liqHouseBalEl.textContent = "0";
      liqBicyBalEl.textContent = "0";
      return;
    }

    try {
      const [hb, bb] = await Promise.all([
        house.balanceOf(account),
        bicy.balanceOf(account),
      ]);

      const houseFmt = ethers.formatUnits(hb, houseDec);
      const bicyFmt = ethers.formatUnits(bb, bicyDec);

      balancesLineEl.textContent = `HOUSE: ${trimNum(houseFmt)} | BICY: ${trimNum(bicyFmt)}`;

      const fromBal = fromToken === "HOUSE" ? houseFmt : bicyFmt;
      const toBal = toToken === "HOUSE" ? houseFmt : bicyFmt;

      fromBalEl.textContent = trimNum(fromBal);
      toBalEl.textContent = trimNum(toBal);

      liqHouseBalEl.textContent = trimNum(houseFmt);
      liqBicyBalEl.textContent = trimNum(bicyFmt);
    } catch (_) {}
  }

  function getSlippagePct() {
    const v = slippageSel.value;
    if (v === "auto") return Number(CFG.ui.slippageDefaultPct || 0.5);
    return Number(v);
  }

  // ✅ SimpleAMM direction (tokenA=HOUSE, tokenB=BICY)
  function getAToB() {
    return (fromToken === "HOUSE" && toToken === "BICY") ? true : false;
  }

  async function connect() {
    setMsg(swapMsg, "");
    setMsg(liqMsg, "");
    setMsg(faucetMsg, "");

    const eth = window.ethereum;
    if (!eth) {
      setMsg(swapMsg, "No wallet detected. Install MetaMask/Rabby/Bitget (enable ONE at a time).");
      return;
    }

    try {
      await loadAbisOnce();
      await ensureChain();

      provider = new ethers.BrowserProvider(eth);

      const accs = await eth.request({ method: "eth_requestAccounts" });
      account = accs?.[0] || null;

      signer = await provider.getSigner();
      makeContracts();

      [houseDec, bicyDec] = await Promise.all([house.decimals(), bicy.decimals()]);
      networkNameEl.textContent = CFG.chain.chainName;

      walletStatusEl.textContent = `Connected: ${shortAddr(account)}`;
      setConnectedUI(true);

      await refreshBalances();
      await updateQuote();
      await syncLiquidityInputs();
    } catch (e) {
      console.error(e);
      const msg = e?.shortMessage || e?.message || String(e);
      setMsg(swapMsg, `Connect failed: ${msg}`);
      setConnectedUI(false);
    }
  }

  function disconnect() {
    provider = null;
    signer = null;
    account = null;

    house = null;
    bicy = null;
    faucet = null;
    amm = null;

    walletStatusEl.textContent = "Not connected";
    balancesLineEl.textContent = "HOUSE: 0 | BICY: 0";
    fromBalEl.textContent = "0";
    toBalEl.textContent = "0";
    liqHouseBalEl.textContent = "0";
    liqBicyBalEl.textContent = "0";

    fromAmountEl.value = "";
    toAmountEl.value = "";
    rateLineEl.textContent = "—";

    liqHouseAmountEl.value = "";
    liqBicyAmountEl.value = "";
    liqRatioEl.textContent = "—";
    liqPreviewEl.textContent = "You will add: —";

    setMsg(swapMsg, "");
    setMsg(liqMsg, "");
    setMsg(faucetMsg, "");

    fromToken = "HOUSE";
    toToken = "BICY";

    setConnectedUI(false);
  }

  async function resetAll() {
    fromAmountEl.value = "";
    toAmountEl.value = "";
    rateLineEl.textContent = "—";

    liqHouseAmountEl.value = "";
    liqBicyAmountEl.value = "";
    liqRatioEl.textContent = "—";
    liqPreviewEl.textContent = "You will add: —";

    setMsg(swapMsg, "");
    setMsg(liqMsg, "");
    setMsg(faucetMsg, "");

    fromToken = "HOUSE";
    toToken = "BICY";

    await refreshBalances();
    await updateQuote();
    await syncLiquidityInputs();
  }

  async function updateQuote() {
    setMsg(swapMsg, "");
    toAmountEl.value = "";
    rateLineEl.textContent = "—";

    if (!provider || !account || !amm) return;

    const raw = (fromAmountEl.value || "").trim();
    const amt = Number(raw);
    if (!raw || !isFinite(amt) || amt <= 0) return;

    try {
      const decIn = fromToken === "HOUSE" ? houseDec : bicyDec;
      const decOut = toToken === "HOUSE" ? houseDec : bicyDec;

      const amountIn = ethers.parseUnits(raw, decIn);
      const out = await amm[CFG.fn.ammGetAmountOut](amountIn, getAToB());

      const outFmt = ethers.formatUnits(out, decOut);
      toAmountEl.value = outFmt;

      const rate = amt > 0 ? (Number(outFmt) / amt) : 0;
      rateLineEl.textContent = rate > 0 ? `1 ${fromToken} ≈ ${trimNum(rate)} ${toToken}` : "—";
    } catch (_) {}
  }

  // ===== Faucet =====
  async function getCooldownRemaining() {
    try {
      if (typeof faucet.canClaim === "function") {
        const ok = await faucet.canClaim(account);
        if (ok) return 0;
      }
    } catch (_) {}

    try {
      const cd = await faucet.cooldown?.();
      const last = await faucet.lastClaim?.(account);
      if (cd == null || last == null) return null;

      const now = Math.floor(Date.now() / 1000);
      const next = Number(last) + Number(cd);
      return Math.max(0, next - now);
    } catch (_) {
      return null;
    }
  }

  async function doClaimBoth() {
    setMsg(faucetMsg, "");

    if (!account || !signer) {
      await connect();
      return;
    }

    btnClaimBoth.disabled = true;

    try {
      const remain = await getCooldownRemaining();
      if (remain != null && remain > 0) {
        const m = Math.floor(remain / 60);
        const s = remain % 60;
        setMsg(faucetMsg, `Cooldown active. Wait ${m}m ${s}s then claim again.`);
        return;
      }

      const fn = (CFG.fn && CFG.fn.faucetClaimBoth) ? CFG.fn.faucetClaimBoth : "claimBoth";

      setMsg(faucetMsg, "Claiming 100 HOUSE + 100 BICY…");
      const tx = await faucet[fn]({ gasLimit: 300000n });
      const rc = await tx.wait();

      setMsg(faucetMsg, `✅ Claim success. Tx: ${rc.hash.slice(0, 10)}…`);
      await refreshBalances();
      await updateQuote();
      await syncLiquidityInputs();
    } catch (e) {
      console.error(e);
      const msg = e?.shortMessage || e?.reason || e?.message || String(e);
      setMsg(faucetMsg, `Claim failed: ${msg}`);
    } finally {
      btnClaimBoth.disabled = false;
    }
  }

  // ===== Swap =====
  async function doSwap() {
    setMsg(swapMsg, "");

    if (!account || !signer) {
      await connect();
      return;
    }

    const raw = (fromAmountEl.value || "").trim();
    const amt = Number(raw);
    if (!raw || !isFinite(amt) || amt <= 0) {
      setMsg(swapMsg, "Enter amount > 0");
      return;
    }

    const decIn = fromToken === "HOUSE" ? houseDec : bicyDec;
    const tokenIn = fromToken === "HOUSE" ? house : bicy;
    const aToB = getAToB();

    btnSwap.disabled = true;

    try {
      const amountIn = ethers.parseUnits(raw, decIn);
      const out = await amm[CFG.fn.ammGetAmountOut](amountIn, aToB);

      const slipPct = getSlippagePct();
      const bps = BigInt(Math.floor(slipPct * 100));
      const minOut = out - (out * bps) / 10000n;

      const allowance = await tokenIn.allowance(account, CFG.contracts.AMM);
      if (allowance < amountIn) {
        setMsg(swapMsg, `Approving ${fromToken}…`);
        const txA = await tokenIn.approve(CFG.contracts.AMM, amountIn);
        await txA.wait();
      }

      setMsg(swapMsg, "Swapping…");
      const tx = await amm[CFG.fn.ammSwap](amountIn, minOut, aToB);
      const rc = await tx.wait();

      setMsg(swapMsg, `✅ Swap success. Tx: ${rc.hash.slice(0, 10)}…`);
      await refreshBalances();
      await updateQuote();
      await syncLiquidityInputs();
    } catch (e) {
      console.error(e);
      const msg = e?.shortMessage || e?.reason || e?.message || String(e);
      setMsg(swapMsg, `Swap failed: ${msg}`);
    } finally {
      btnSwap.disabled = false;
    }
  }

  // ===== Liquidity (AUTO) =====
  function setLiqPreview(hStr, bStr) {
    if (!hStr || !bStr) {
      liqPreviewEl.textContent = "You will add: —";
      return;
    }
    liqPreviewEl.textContent = `You will add: ${trimNum(hStr)} HOUSE + ${trimNum(bStr)} BICY`;
  }

  // ✅ ALWAYS WORKS: reserves = token balances held by AMM
  async function getReservesByTokenBalances() {
    if (!house || !bicy) return null;
    const [rH, rB] = await Promise.all([
      house.balanceOf(CFG.contracts.AMM),
      bicy.balanceOf(CFG.contracts.AMM),
    ]);
    return { rH, rB };
  }

  async function syncLiquidityInputs() {
    if (!provider || !account || !amm) return;

    const rawH0 = (liqHouseAmountEl.value || "").trim();
    const rawB0 = (liqBicyAmountEl.value || "").trim();

    // empty -> clear
    if ((!rawH0 || Number(rawH0) <= 0) && (!rawB0 || Number(rawB0) <= 0)) {
      liqRatioEl.textContent = "—";
      setLiqPreview("", "");
      return;
    }

    // get reserves
    let reserves = null;
    try {
      reserves = await getReservesByTokenBalances();
    } catch (_) {
      reserves = null;
    }

    if (!reserves || reserves.rH == null || reserves.rB == null) {
      liqRatioEl.textContent = "unavailable";
      setLiqPreview("", "");
      return;
    }

    const rH = reserves.rH;
    const rB = reserves.rB;

    // pool empty -> allow manual both (no auto)
    if (rH === 0n || rB === 0n) {
      liqRatioEl.textContent = "empty pool (set initial amounts)";
      if (rawH0 && rawB0) setLiqPreview(rawH0, rawB0);
      else setLiqPreview("", "");
      return;
    }

    // show ratio
    const ratio = Number(ethers.formatUnits(rB, bicyDec)) / Number(ethers.formatUnits(rH, houseDec));
    liqRatioEl.textContent = isFinite(ratio) && ratio > 0 ? `1 HOUSE ≈ ${trimNum(ratio)} BICY` : "—";

    try {
      liqIsSyncing = true;

      if (liqLastEdited === "HOUSE") {
        const rawH = (liqHouseAmountEl.value || "").trim();
        const nH = Number(rawH);
        if (!rawH || !isFinite(nH) || nH <= 0) {
          liqBicyAmountEl.value = "";
          setLiqPreview("", "");
          return;
        }

        const amtH = ethers.parseUnits(rawH, houseDec);
        const amtB = (amtH * rB) / rH;
        const bFmt = ethers.formatUnits(amtB, bicyDec);
        liqBicyAmountEl.value = bFmt;

        setLiqPreview(rawH, bFmt);
      } else {
        const rawB = (liqBicyAmountEl.value || "").trim();
        const nB = Number(rawB);
        if (!rawB || !isFinite(nB) || nB <= 0) {
          liqHouseAmountEl.value = "";
          setLiqPreview("", "");
          return;
        }

        const amtB = ethers.parseUnits(rawB, bicyDec);
        const amtH = (amtB * rH) / rB;
        const hFmt = ethers.formatUnits(amtH, houseDec);
        liqHouseAmountEl.value = hFmt;

        setLiqPreview(hFmt, rawB);
      }
    } catch (_) {
      // ignore parse errors
    } finally {
      liqIsSyncing = false;
    }
  }

  // ===== Add Liquidity =====
  async function ensureApprove(token, amount, label) {
    const allowance = await token.allowance(account, CFG.contracts.AMM);
    if (allowance >= amount) return;

    setMsg(liqMsg, `Approving ${label}…`);
    const tx = await token.approve(CFG.contracts.AMM, amount);
    await tx.wait();
  }

  async function doAddLiquidity() {
    setMsg(liqMsg, "");

    if (!account || !signer) {
      await connect();
      return;
    }

    // ensure auto sync before submit
    await syncLiquidityInputs();

    const rawH = (liqHouseAmountEl.value || "").trim();
    const rawB = (liqBicyAmountEl.value || "").trim();

    const nH = Number(rawH);
    const nB = Number(rawB);

    if (!rawH || !isFinite(nH) || nH <= 0) {
      setMsg(liqMsg, "Enter HOUSE amount > 0");
      return;
    }
    if (!rawB || !isFinite(nB) || nB <= 0) {
      setMsg(liqMsg, "Enter BICY amount > 0");
      return;
    }

    btnAddLiquidity.disabled = true;

    try {
      const amtH = ethers.parseUnits(rawH, houseDec);
      const amtB = ethers.parseUnits(rawB, bicyDec);

      await ensureApprove(house, amtH, "HOUSE");
      await ensureApprove(bicy, amtB, "BICY");

      setMsg(liqMsg, "Adding liquidity…");

      const fn = (CFG.fn && CFG.fn.ammAddLiquidity) ? CFG.fn.ammAddLiquidity : "addLiquidity";
      const tx = await amm[fn](amtH, amtB);
      const rc = await tx.wait();

      setMsg(liqMsg, `✅ Liquidity added. Tx: ${rc.hash.slice(0, 10)}…`);

      liqHouseAmountEl.value = "";
      liqBicyAmountEl.value = "";
      liqRatioEl.textContent = "—";
      liqPreviewEl.textContent = "You will add: —";

      await refreshBalances();
      await updateQuote();
      await syncLiquidityInputs();
    } catch (e) {
      console.error(e);
      const msg = e?.shortMessage || e?.reason || e?.message || String(e);
      setMsg(liqMsg, `Add liquidity failed: ${msg}`);
    } finally {
      btnAddLiquidity.disabled = false;
    }
  }

  // ===== Events =====
  btnConnectTop?.addEventListener("click", connect);
  btnDisconnect?.addEventListener("click", disconnect);
  btnReset?.addEventListener("click", resetAll);

  tabSwap?.addEventListener("click", () => setTab("swap"));
  tabFaucet?.addEventListener("click", () => setTab("faucet"));
  tabLiquidity?.addEventListener("click", async () => {
    setTab("liq");
    await refreshBalances();
    await syncLiquidityInputs();
  });

  fromAmountEl?.addEventListener("input", () => updateQuote());
  slippageSel?.addEventListener("change", () => updateQuote());

  btnFlip?.addEventListener("click", async () => {
    [fromToken, toToken] = [toToken, fromToken];
    setMsg(swapMsg, "");
    setMsg(liqMsg, "");
    setMsg(faucetMsg, "");
    await refreshBalances();
    await updateQuote();
  });

  // Liquidity: type ONE side -> auto fill other (when pool not empty)
  liqHouseAmountEl?.addEventListener("input", async () => {
    if (liqIsSyncing) return;
    liqLastEdited = "HOUSE";
    await syncLiquidityInputs();
  });

  liqBicyAmountEl?.addEventListener("input", async () => {
    if (liqIsSyncing) return;
    liqLastEdited = "BICY";
    await syncLiquidityInputs();
  });

  btnSwap?.addEventListener("click", doSwap);
  btnClaimBoth?.addEventListener("click", doClaimBoth);
  btnAddLiquidity?.addEventListener("click", doAddLiquidity);

  // wallet events
  if (window.ethereum) {
    window.ethereum.on?.("accountsChanged", async () => {
      disconnect();
      await connect();
    });

    window.ethereum.on?.("chainChanged", async () => {
      window.location.reload();
    });
  }

  // init
  networkNameEl.textContent = CFG.chain.chainName;
  setConnectedUI(false);
  setTab("swap");
})();
