/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { motion, AnimatePresence } from "motion/react";
import { 
  ShieldAlert, 
  Coins, 
  Settings, 
  Play, 
  RotateCcw, 
  Skull, 
  Anchor, 
  Flame, 
  AlertTriangle,
  CloudRain,
  Wind,
  Cloud,
  Trophy,
  LogOut,
  LogIn,
  X,
  Shield,
  Banknote
} from "lucide-react";
import { auth, loginWithGoogle, logout, db } from "./firebase";
import { onAuthStateChanged, User } from "firebase/auth";
import { collection, query, where, orderBy, limit, getDocs, doc, setDoc, getDoc, serverTimestamp } from "firebase/firestore";

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: any;
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData?.map(provider => ({
        providerId: provider.providerId,
        email: provider.email,
      })) || []
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

// Weather types
type WeatherType = "clear" | "rain" | "fog";

interface Objective {
  id: string;
  title: string;
  description: string;
  target: number;
  type: "distance" | "cash" | "toll" | "hazard" | "time_cargo" | "escort";
  timeLimit?: number; // Time limit in seconds
}

const MISSIONS: Objective[] = [
  { id: "m1", title: "Training Run", description: "Reach 500 nautical miles", target: 500, type: "distance" },
  { id: "m2", title: "Toll Master", description: "Navigate through 1 toll inspection", target: 1, type: "toll" },
  { id: "m3", title: "Ocean Veteran", description: "Accumulate $1,500 in cargo revenue", target: 1500, type: "cash" },
  { id: "m4", title: "Zero Visibility", description: "Survive 800 NM in hazardous fog", target: 800, type: "hazard" },
  { id: "m5", title: "Rush Delivery", description: "Deliver cargo (1500 NM) in 60 seconds", target: 1500, type: "time_cargo", timeLimit: 60 },
  { id: "m6", title: "VIP Escort", description: "Escort a naval vessel for 2000 NM", target: 2000, type: "escort" },
  { id: "m7", title: "Endless Pass", description: "Reach 10,000 NM", target: 10000, type: "distance" },
];

// Cargo types
type CargoType = "crude" | "lng" | "chemicals";

const CARGO_STATS = {
  crude:     { name: "Crude Oil",             color: "tanker-deck",   baseSpeed: 4.0,  handling: 0.12, waveFactor: 0.8 },
  lng:       { name: "Liquefied Natural Gas", color: "bg-slate-300",  baseSpeed: 5.5,  handling: 0.2,  waveFactor: 1.4 },
  chemicals: { name: "Hazardous Chemicals",   color: "bg-cyan-800",   baseSpeed: 4.5,  handling: 0.15, waveFactor: 1.1 },
};

// Types
type GameStatus = "start" | "playing" | "levy" | "gameOver";

interface GameObject {
  id: number;
  x: number;
  y: number;
  width: number;
  height: number;
  type: "mine" | "levy" | "bonus" | "boost" | "fuel" | "shield";
  speed: number;
  vx: number;
}

interface TerrainSlice {
  id: number;
  y: number;
  leftWidth: number;
  rightWidth: number;
}

interface Upgrades {
  hull: number;
  engine: number;
  toll: number;
  funds: number;
}

const TANKER_WIDTH = 38;
const TANKER_HEIGHT = 120;
const INITIAL_CASH = 500;
const INITIAL_HEALTH = 100;
const LEVY_COST = 150;

export default function App() {
  const [status, setStatus] = useState<GameStatus>("start");
  const [score, setScore] = useState(0);
  const [cash, setCash] = useState(INITIAL_CASH);
  const [health, setHealth] = useState(INITIAL_HEALTH);
  const [tankerX, setTankerX] = useState(0);
  const [tankerRotation, setTankerRotation] = useState(0);
  const [objects, setObjects] = useState<GameObject[]>([]);
  const [explosions, setExplosions] = useState<{id: number, x: number, y: number}[]>([]);
  const [terrain, setTerrain] = useState<TerrainSlice[]>([]);
  const [distance, setDistance] = useState(0);
  const [weather, setWeather] = useState<WeatherType>("clear");
  const [fogDensity, setFogDensity] = useState(0);
  const [currentMissionIndex, setCurrentMissionIndex] = useState(0);
  const [tollsCompleted, setTollsCompleted] = useState(0);
  const [showMissionToast, setShowMissionToast] = useState(false);
  const [showUpgrades, setShowUpgrades] = useState(false);
  const [missionTimer, setMissionTimer] = useState<number | null>(null);
  const [missionStartMetric, setMissionStartMetric] = useState<number>(0);
  const [tankerYOffset, setTankerYOffset] = useState(0);
  const [cargoType, setCargoType] = useState<CargoType>("crude");

  // ── Fuel & Shield ────────────────────────────────────────────────────
  const INITIAL_FUEL = 100;
  const [fuel, setFuel] = useState(INITIAL_FUEL);
  const fuelRef = useRef(INITIAL_FUEL);
  const [shield, setShield] = useState(0); // number of shield charges
  const shieldRef = useRef(0);
  const [showIAP, setShowIAP] = useState(false);
  const [iapReason, setIapReason] = useState<"fuel" | "shield">("fuel");
  const lastFuelSpawnRef = useRef(0);

  // Pre-generate random positions once so they don't jump on every render frame.
  // These are purely visual – re-generating each frame was a major iOS perf bug.
  const rainStreaks = useMemo(() =>
    [...Array(40)].map(() => ({
      left: `${Math.random() * 100}%`,
      animationDelay: `${Math.random() * 2}s`,
      animationDuration: `${0.3 + Math.random() * 0.3}s`,
      opacity: 0.2 + Math.random() * 0.3,
    })), []);

  const fogLayers = useMemo(() =>
    [...Array(5)].map((_, i) => ({
      top: `${Math.random() * 100}%`,
      left: `${Math.random() * 100}%`,
      width: `${400 + Math.random() * 400}px`,
      height: `${400 + Math.random() * 400}px`,
      animationDelay: `${i * 2}s`,
    })), []);

  // Persistent State
  const [upgrades, setUpgrades] = useState<{hull: number, engine: number, toll: number, funds: number}>(() => {
    const saved = localStorage.getItem('ocean-cargo-upgrades');
    return saved ? JSON.parse(saved) : { hull: 0, engine: 0, toll: 0, funds: 0 };
  });
  const [bankBalance, setBankBalance] = useState<number>(() => {
    const saved = localStorage.getItem('ocean-cargo-bank');
    return saved ? parseInt(saved, 10) : 0;
  });
  const bankSavedRef = useRef<boolean>(false);

  const buyUpgrade = (type: keyof Upgrades) => {
    if (upgrades[type] >= 5) return;
    const cost = 500 * (upgrades[type] + 1);
    if (bankBalance >= cost) {
      setBankBalance(prev => {
        const nb = prev - cost;
        localStorage.setItem("ocean-cargo-bank", nb.toString());
        return nb;
      });
      setUpgrades(prev => {
        const next = { ...prev, [type]: prev[type] + 1 };
        localStorage.setItem("ocean-cargo-upgrades", JSON.stringify(next));
        return next;
      });
    }
  };

  // Computed Upgrade Values
  const maxHealth = INITIAL_HEALTH + upgrades.hull * 20;
  const initialCash = INITIAL_CASH + upgrades.funds * 200;
  const tollDiscount = 1 - (upgrades.toll * 0.1); // up to 50% discount at level 5
  const engineBoost = 1 + (upgrades.engine * 0.05); // up to 25% boost at level 5

  // Firebase/Leaderboard State
  const [user, setUser] = useState<User | null>(null);
  const [leaderboard, setLeaderboard] = useState<any[]>([]);
  const [showLeaderboard, setShowLeaderboard] = useState(false);

  // Toll Mini-game State
  const [tollProgress, setTollProgress] = useState(0);
  const [tollDirection, setTollDirection] = useState(1);
  const [tollActive, setTollActive] = useState(false);

  // Power-ups State
  const [boostActive, setBoostActive] = useState(false);
  const [boostCountdown, setBoostCountdown] = useState(0);
  const boostActiveRef = useRef(false);

  const healthRef = useRef<number>(INITIAL_HEALTH);
  const speedMultiplierRef = useRef<number>(1);
  const impactRotationRef = useRef<number>(0);
  const screenShakeRef = useRef<number>(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const gameLoopRef = useRef<number>(0);
  const lastTimeRef = useRef<number>(0);
  const objectIdRef = useRef<number>(0);
  const targetXRef = useRef<number>(0);
  const currentXRef = useRef<number>(0);
  const noiseSeedRef = useRef<number>(Math.random() * 1000);

  const containerWidth = containerRef.current?.clientWidth || 400;
  const containerHeight = containerRef.current?.clientHeight || 600;
  const tankerY = containerHeight - TANKER_HEIGHT - 80;

  // Sound Refs
  const seagullSound = useRef<HTMLAudioElement | null>(null);
  const foghornSound = useRef<HTMLAudioElement | null>(null);
  const rainSound = useRef<HTMLAudioElement | null>(null);
  const ambientOceanSound = useRef<HTMLAudioElement | null>(null);
  const engineSound = useRef<HTMLAudioElement | null>(null);
  const explosionSound = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    if (explosions.length > 0) {
      const timer = setTimeout(() => {
        setExplosions(prev => prev.slice(1));
      }, 1000);
      return () => clearTimeout(timer);
    }
  }, [explosions]);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u);
    });
    return unsub;
  }, []);

  const fetchLeaderboard = async () => {
    try {
      const q = query(collection(db, "leaderboard"), where("score", ">=", 0), orderBy("score", "desc"), limit(10));
      const snap = await getDocs(q);
      const scores = snap.docs.map(d => d.data());
      setLeaderboard(scores);
    } catch (e: any) {
      if (e?.message?.includes("permission")) {
        handleFirestoreError(e, OperationType.LIST, "leaderboard");
      } else {
        console.error(e);
      }
    }
  };

  useEffect(() => {
    if (showLeaderboard) {
      fetchLeaderboard();
    }
  }, [showLeaderboard]);

  const submitScore = async () => {
    if (!user) return;
    try {
      const d = await getDoc(doc(db, "leaderboard", user.uid));
      if (d.exists()) {
        if (d.data().score < score) {
          await setDoc(doc(db, "leaderboard", user.uid), {
            userId: user.uid,
            displayName: user.displayName || "Anonymous Captain",
            score,
            distance: score,
            cash,
            cargoType,
            updatedAt: serverTimestamp()
          }, { merge: true });
        }
      } else {
        await setDoc(doc(db, "leaderboard", user.uid), {
          userId: user.uid,
          displayName: user.displayName || "Anonymous Captain",
          score,
          distance: score,
          cash,
          cargoType,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        });
      }
    } catch (e: any) {
      if (e?.message?.includes("permission")) {
        handleFirestoreError(e, OperationType.WRITE, "leaderboard");
      } else {
        console.error(e);
      }
    }
  };

  useEffect(() => {
    if (status === "gameOver") {
      submitScore();
    }
  }, [status]);

  useEffect(() => {
    seagullSound.current = new Audio("https://www.soundjay.com/nature/sounds/seagull-1.mp3");
    if (seagullSound.current) seagullSound.current.volume = 0.15;
    
    foghornSound.current = new Audio("https://www.soundjay.com/transportation/sounds/ship-horn-1.mp3");
    if (foghornSound.current) foghornSound.current.volume = 0.1;
    
    rainSound.current = new Audio("https://www.soundjay.com/nature/sounds/rain-07.mp3");
    if (rainSound.current) {
      rainSound.current.loop = true;
      rainSound.current.volume = 0.2;
    }

    ambientOceanSound.current = new Audio("https://www.soundjay.com/nature/sounds/ocean-wave-1.mp3");
    if (ambientOceanSound.current) {
      ambientOceanSound.current.loop = true;
      ambientOceanSound.current.volume = 0.15;
    }

    engineSound.current = new Audio("https://www.soundjay.com/transportation/sounds/boat-engine-1.mp3");
    if (engineSound.current) {
      engineSound.current.loop = true;
      engineSound.current.volume = 0.1;
    }

    explosionSound.current = new Audio("https://www.soundjay.com/mechanical/sounds/explosion-01.mp3");
    if (explosionSound.current) {
      explosionSound.current.volume = 0.4;
    }

    return () => {
      [seagullSound, foghornSound, rainSound, ambientOceanSound, engineSound, explosionSound].forEach(s => {
        if (s.current) {
          s.current.pause();
          s.current = null;
        }
      });
    };
  }, []);

  const playSound = (type: "seagull" | "foghorn" | "explosion") => {
    let s: HTMLAudioElement | null = null;
    if (type === "seagull") s = seagullSound.current;
    if (type === "foghorn") s = foghornSound.current;
    if (type === "explosion") s = explosionSound.current;
    
    if (s) {
      s.currentTime = 0;
      s.play().catch(() => {});
    }
  };

  useEffect(() => {
    if (status !== "playing") return;
    
    const mission = MISSIONS[currentMissionIndex];
    if (!mission) return;

    let satisfied = false;
    let failed = false;
    
    // Calculate progress relative to mission start if needed, or total target
    if (mission.type === "distance" && score >= mission.target) satisfied = true;
    if (mission.type === "cash" && cash >= mission.target) satisfied = true;
    if (mission.type === "toll" && tollsCompleted >= mission.target) satisfied = true;
    
    if (mission.type === "hazard") {
      if (score >= missionStartMetric + mission.target) satisfied = true;
    }
    
    if (mission.type === "time_cargo") {
      if (score >= missionStartMetric + mission.target) satisfied = true;
      if (missionTimer === 0 && !satisfied) failed = true;
    }
    
    if (mission.type === "escort") {
      if (score >= missionStartMetric + mission.target) satisfied = true;
    }

    if (satisfied) {
      // Bonus cash for completing mission
      setCash(c => c + 300);
      setShowMissionToast(true);
      setCurrentMissionIndex(prev => Math.min(prev + 1, MISSIONS.length - 1));
      setTimeout(() => setShowMissionToast(false), 4000);
    } else if (failed) {
      setStatus("gameOver");
    }
  }, [score, cash, tollsCompleted, currentMissionIndex, status, missionStartMetric, missionTimer]);

  // Save bank on game over
  useEffect(() => {
    if (status === "gameOver" && !bankSavedRef.current) {
      setBankBalance(prev => {
        const nb = prev + cash;
        localStorage.setItem("ocean-cargo-bank", nb.toString());
        return nb;
      });
      bankSavedRef.current = true;
    }
  }, [status, cash]);

  // Mission Initialization
  useEffect(() => {
    const mission = MISSIONS[currentMissionIndex];
    if (!mission) return;
    
    setMissionStartMetric(score);
    
    if (mission.timeLimit) {
      setMissionTimer(mission.timeLimit);
    } else {
      setMissionTimer(null);
    }

    if (mission.type === "hazard") {
      setWeather("fog");
      setFogDensity(1);
    } else {
      setWeather("clear");
      setFogDensity(0);
    }
  }, [currentMissionIndex]);

  // Timer Tick
  useEffect(() => {
    if (status !== "playing" || missionTimer === null || missionTimer <= 0) return;
    const interval = setInterval(() => {
      setMissionTimer(prev => (prev !== null && prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(interval);
  }, [status, missionTimer]);

  // Boost Timer Tick
  useEffect(() => {
    if (status !== "playing" || !boostActive) return;
    const interval = setInterval(() => {
      setBoostCountdown(prev => {
        if (prev <= 1) {
          setBoostActive(false);
          boostActiveRef.current = false;
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [status, boostActive]);

  useEffect(() => {
    if (engineSound.current) {
      engineSound.current.playbackRate = boostActive ? 1.5 : 1.0;
    }
  }, [boostActive]);

  useEffect(() => {
    if (status !== "playing") {
      if (rainSound.current) rainSound.current.pause();
      if (ambientOceanSound.current) ambientOceanSound.current.pause();
      if (engineSound.current) engineSound.current.pause();
      return;
    } else {
      if (ambientOceanSound.current) ambientOceanSound.current.play().catch(() => {});
      if (engineSound.current) engineSound.current.play().catch(() => {});
    }

    const interval = setInterval(() => {
      const rand = Math.random();
      if (rand < 0.3) {
        setWeather(prev => {
          const next = prev === "clear" ? (Math.random() > 0.5 ? "rain" : "fog") : "clear";
          if (next === "rain" && rainSound.current) rainSound.current.play().catch(() => {});
          if (next !== "rain" && rainSound.current) rainSound.current.pause();
          return next;
        });
      }

      // Random environmental sounds
      if (Math.random() < 0.2) playSound("seagull");
      if (Math.random() < 0.05) playSound("foghorn");
    }, 15000);

    return () => clearInterval(interval);
  }, [status]);

  useEffect(() => {
    if (weather === "fog") {
      setFogDensity(0.8);
    } else {
      setFogDensity(0);
    }
  }, [weather]);

  // Toll bar logic
  useEffect(() => {
    if (status === "levy" && tollActive) {
      const interval = setInterval(() => {
        setTollProgress(prev => {
          let next = prev + (4 * tollDirection);
          if (next >= 100 || next <= 0) {
            setTollDirection(d => d * -1);
          }
          return Math.max(0, Math.min(100, next));
        });
      }, 16);
      return () => clearInterval(interval);
    }
  }, [status, tollActive, tollDirection]);

  // Initialize Tanker X and Terrain
  useEffect(() => {
    if (containerRef.current) {
      const w = containerRef.current.clientWidth;
      const h = containerRef.current.clientHeight;
      const initialX = w / 2 - TANKER_WIDTH / 2;
      setTankerX(initialX);
      targetXRef.current = initialX;
      currentXRef.current = initialX;

      // Initial terrain slices
      const slices: TerrainSlice[] = [];
      for (let y = -200; y < h + 200; y += 40) {
        slices.push({
          id: objectIdRef.current++,
          y,
          leftWidth: 40 + Math.sin(y * 0.01) * 20,
          rightWidth: 40 + Math.cos(y * 0.01) * 20,
        });
      }
      setTerrain(slices);
    }
  }, []);

  const spawnObject = useCallback((width: number, type: "mine" | "levy" | "bonus" | "boost", leftBound: number, rightBound: number, difficultyScale = 1) => {
    const id = ++objectIdRef.current;
    const objWidth = (type === "bonus" || type === "boost") ? 30 : 50;
    const availableWidth = width - leftBound - rightBound - objWidth;
    const x = leftBound + Math.random() * availableWidth;
    
    return {
      id,
      x,
      y: -100,
      width: objWidth,
      height: type === "levy" ? 60 : objWidth,
      type,
      speed: (1.5 + Math.random() * 2) * difficultyScale,
      vx: type === "mine" ? (Math.random() > 0.5 ? 1 : -1) * (0.5 + Math.random() * 1.0 * difficultyScale) : 0,
    };
  }, []);

  const handleMouseMove = (e: React.MouseEvent | React.TouchEvent) => {
    if (status !== "playing") return;
    if (!containerRef.current) return;

    let clientX = 0;
    if ("touches" in e) {
      clientX = e.touches[0].clientX;
    } else {
      clientX = (e as React.MouseEvent).clientX;
    }

    const rect = containerRef.current.getBoundingClientRect();
    const x = clientX - rect.left - TANKER_WIDTH / 2;
    // Bounds check with terrain logic is done in game loop for currentY, 
    // but here we just constrain to the total container for now
    targetXRef.current = x;
  };

  const startGame = () => {
    setScore(0);
    setCash(initialCash);
    setHealth(maxHealth);
    healthRef.current = maxHealth;
    speedMultiplierRef.current = 1;
    impactRotationRef.current = 0;
    screenShakeRef.current = 0;
    setObjects([]);
    setDistance(0);
    setCurrentMissionIndex(0);
    setMissionStartMetric(0);
    setTollsCompleted(0);
    setStatus("playing");
    setBoostActive(false);
    boostActiveRef.current = false;
    bankSavedRef.current = false;
    setFuel(INITIAL_FUEL);
    fuelRef.current = INITIAL_FUEL;
    setShield(0);
    shieldRef.current = 0;
    lastFuelSpawnRef.current = 0;
    
    if (containerRef.current) {
      const initialX = containerRef.current.clientWidth / 2 - TANKER_WIDTH / 2;
      setTankerX(initialX);
      targetXRef.current = initialX;
      currentXRef.current = initialX;
    }
  };

  const handleTollAction = () => {
    // 40-60 is the "Perfect" zone
    const isPerfect = tollProgress >= 40 && tollProgress <= 60;
    const isGood = tollProgress >= 25 && tollProgress <= 75;

    const actualToll = Math.floor(LEVY_COST * tollDiscount);

    if (isPerfect) {
      setCash(prev => prev - Math.floor(actualToll * 0.5));
      setTollsCompleted(prev => prev + 1);
      setStatus("playing");
    } else if (isGood) {
      setCash(prev => prev - actualToll);
      setTollsCompleted(prev => prev + 1);
      setStatus("playing");
    } else {
      // Failed timing - pay more or take damage
      if (cash >= actualToll * 1.5) {
        setCash(prev => prev - Math.floor(actualToll * 1.5));
        setStatus("playing");
      } else {
        const nextHealth = Math.max(0, healthRef.current - 35);
        setHealth(nextHealth);
        healthRef.current = nextHealth;
        if (nextHealth <= 0) setStatus("gameOver");
        else setStatus("playing");
      }
    }
    setTollActive(false);
  };

  const repairShip = () => {
    if (cash >= 100 && healthRef.current < maxHealth) {
      setCash(prev => prev - 100);
      const newHealth = Math.min(maxHealth, healthRef.current + 25);
      healthRef.current = newHealth;
      setHealth(newHealth);
    }
  };

  useEffect(() => {
    if (status !== "playing") return;

    const gameLoop = (time: number) => {
      const stats = CARGO_STATS[cargoType];

      // Physics recoveries
      speedMultiplierRef.current += (1 - speedMultiplierRef.current) * 0.05;
      // Fast decay — snaps back in ~15 frames; zero out when tiny to prevent linger
      impactRotationRef.current *= 0.75;
      if (Math.abs(impactRotationRef.current) < 0.3) impactRotationRef.current = 0;
      
      if (screenShakeRef.current > 0) {
          screenShakeRef.current--;
          const intensity = screenShakeRef.current * 1.5;
          const xShake = (Math.random() - 0.5) * intensity;
          const yShake = (Math.random() - 0.5) * intensity;
          if (containerRef.current) {
              containerRef.current.style.transform = `translate(${xShake}px, ${yShake}px)`;
          }
      } else if (containerRef.current && containerRef.current.style.transform !== "none" && containerRef.current.style.transform !== "") {
          containerRef.current.style.transform = "none";
      }
      
      // Health penalty (1.0 at full health, drops to 0.4 at 0 health)
      const healthFactor = 0.4 + (healthRef.current / maxHealth) * 0.6;
      
      const activeBoostFactor = boostActiveRef.current ? 1.5 : 1;
      const speed = stats.baseSpeed * healthFactor * speedMultiplierRef.current * engineBoost * activeBoostFactor;
      
      // Smooth movement physics - Sharper acceleration and turning
      // Slippery in rain, adjusted by cargo handling and health
      const baseHandling = weather === "rain" ? stats.handling * 0.6 : stats.handling;
      const lerpFactor = baseHandling * healthFactor;
      
      // Find land width at the tanker's vertical position
      const relevantSlice = terrain.find(s => s.y > tankerY - 20 && s.y < tankerY + 180);
      const lBound = relevantSlice?.leftWidth || 50;
      const rBound = (containerWidth - (relevantSlice?.rightWidth || 50)) - TANKER_WIDTH;
      
      const constrainedTargetX = Math.max(lBound, Math.min(targetXRef.current, rBound));
      const xDiff = constrainedTargetX - currentXRef.current;
      currentXRef.current += xDiff * lerpFactor;
      
      setTankerX(currentXRef.current);

      // Pronounced Wave Interaction Physics
      const waveFactor = CARGO_STATS[cargoType].waveFactor;
      const waveSpeed = (weather === "clear" ? 0.003 : weather === "rain" ? 0.005 : 0.002) * waveFactor;
      const waveHeight = (weather === "clear" ? 4 : weather === "rain" ? 12 : 3) * waveFactor;
      const waveRoll = (weather === "clear" ? 2 : weather === "rain" ? 5 : 1) * waveFactor;

      const bobbing = Math.sin(time * waveSpeed) * waveHeight;

      setTankerYOffset(bobbing);
      // Lean only from movement — no rolling, no impact spin bleeding through
      // Tight ±8 clamp stops Framer Motion interpolating through 360°
      setTankerRotation(Math.max(-8, Math.min(8, xDiff * 0.06)));

      // Terrain scrolling
      setTerrain(prevTerrain => {
        let updatedTerrain = prevTerrain.map(s => ({ ...s, y: s.y + speed }));
        if (updatedTerrain[0].y > 0) {
          const lastSlice = updatedTerrain[updatedTerrain.length - 1];
          const nextY = lastSlice.y - 40;
          updatedTerrain.push({
            id: objectIdRef.current++,
            y: nextY,
            // Vary the strait width over time
            leftWidth: 60 + Math.sin(nextY * 0.01 + noiseSeedRef.current) * 40,
            rightWidth: 60 + Math.cos(nextY * 0.015 + noiseSeedRef.current) * 40,
          });
        }
        return updatedTerrain.filter(s => s.y < 1200);
      });

      setDistance(prev => {
        const nextDist = prev + 0.1;
        const difficultyScale = 1 + (nextDist / 1000);

        // ── Fuel drain (drains fully over ~500 distance units) ──────────
        const newFuel = Math.max(0, fuelRef.current - 0.02);
        fuelRef.current = newFuel;
        setFuel(newFuel);
        if (newFuel <= 0) {
          setIapReason("fuel");
          setShowIAP(true);
          setStatus("gameOver");
        }

        // ── Spawn fuel pickup every ~300 distance ──────────────────────
        if (nextDist - lastFuelSpawnRef.current >= 300) {
          lastFuelSpawnRef.current = nextDist;
          setObjects(o => [...o, spawnObject(containerWidth, "fuel", 100, 100, difficultyScale)]);
        }
        
        setObjects(currentObjects => {
          let updated = currentObjects.map(obj => {
            let nextX = obj.x + (obj.vx || 0);
            
            // Simple bound check for drifting mines
            if (nextX <= 60) {
              obj.vx = Math.abs(obj.vx);
              nextX = obj.x + obj.vx;
            } else if (nextX >= containerWidth - 60 - obj.width) {
              obj.vx = -Math.abs(obj.vx);
              nextX = obj.x + obj.vx;
            }

            return {
              ...obj,
              x: nextX,
              y: obj.y + (obj.type === "levy" ? speed : obj.speed + speed * 0.5)
            }
          }).filter(obj => obj.y < 1200);

          if (Math.random() < 0.015 * Math.min(difficultyScale, 2)) {
            const types: GameObject["type"][] = ["mine", "mine", "mine", "bonus", "boost", "shield"];
            const type = types[Math.floor(Math.random() * types.length)];
            updated.push(spawnObject(containerWidth, type, 100, 100, difficultyScale));
          }

          if (Math.floor(nextDist) % 800 === 0 && Math.floor(nextDist) !== 0 && !currentObjects.find(o => o.type === "levy")) {
              if (Math.random() < 0.1) {
                 updated.push(spawnObject(containerWidth, "levy", 100, 100, difficultyScale));
              }
          }

          const updatedWithCollisions = updated.filter(obj => {
            const shipX = currentXRef.current;
            const colliding = (
              shipX < obj.x + obj.width &&
              shipX + TANKER_WIDTH > obj.x &&
              tankerY < obj.y + obj.height &&
              tankerY + TANKER_HEIGHT > obj.y
            );

            if (colliding) {
              if (obj.type === "mine") {
                // Shield absorbs the hit
                if (shieldRef.current > 0) {
                  shieldRef.current -= 1;
                  setShield(shieldRef.current);
                  setExplosions(prev => [...prev, { id: Date.now() + Math.random(), x: obj.x, y: obj.y }]);
                  playSound("explosion");
                  return false;
                }
                const newHealth = Math.max(0, healthRef.current - 15);
                setHealth(newHealth);
                healthRef.current = newHealth;
                setExplosions(prev => [...prev, { id: Date.now() + Math.random(), x: obj.x, y: obj.y }]);
                playSound("explosion");
                speedMultiplierRef.current = -0.8;
                impactRotationRef.current = (Math.random() > 0.5 ? 1 : -1) * 10;
                targetXRef.current += (Math.random() > 0.5 ? 1 : -1) * 30;
                screenShakeRef.current = 20;
                if (newHealth <= 0) setStatus("gameOver");
                return false;
              }
              if (obj.type === "levy") {
                setStatus("levy");
                setTollActive(true);
                setTollProgress(0);
                return false;
              }
              if (obj.type === "bonus") {
                setCash(c => c + 75);
                return false;
              }
              if (obj.type === "boost") {
                setBoostActive(true);
                boostActiveRef.current = true;
                setBoostCountdown(10);
                return false;
              }
              if (obj.type === "fuel") {
                const newFuel = Math.min(100, fuelRef.current + 40);
                fuelRef.current = newFuel;
                setFuel(newFuel);
                return false;
              }
              if (obj.type === "shield") {
                shieldRef.current = Math.min(3, shieldRef.current + 1);
                setShield(shieldRef.current);
                return false;
              }
            }
            return true;
          });

          // Check for land collision (crashing into shore)
          let shoreHit = false;
          if (currentXRef.current <= lBound) {
             const newHealth = Math.max(0, healthRef.current - 0.5);
             setHealth(newHealth);
             healthRef.current = newHealth;

             // Shore Bounce Physics
             speedMultiplierRef.current = 0.1; // Hard slowdown
             impactRotationRef.current = 8; // Tilt away from shore (right)
             targetXRef.current = lBound + 40; // Push target coordinate away
             currentXRef.current = lBound + 1; // Unstick
             screenShakeRef.current = Math.max(screenShakeRef.current, 5); // Mild rumble

             shoreHit = true;
          } else if (currentXRef.current >= rBound) {
             const newHealth = Math.max(0, healthRef.current - 0.5);
             setHealth(newHealth);
             healthRef.current = newHealth;
             
             // Shore Bounce Physics
             speedMultiplierRef.current = 0.1; // Hard slowdown
             impactRotationRef.current = -8; // Tilt away from shore (left)
             targetXRef.current = rBound - 40; // Push target coordinate away
             currentXRef.current = rBound - 1; // Unstick
             screenShakeRef.current = Math.max(screenShakeRef.current, 5); // Mild rumble

             shoreHit = true;
          }

          if (shoreHit && healthRef.current <= 0) setStatus("gameOver");

          return updatedWithCollisions;
        });
        
        setScore(Math.floor(nextDist));
        return nextDist;
      });

      gameLoopRef.current = requestAnimationFrame(gameLoop);
    };

    lastTimeRef.current = performance.now();
    gameLoopRef.current = requestAnimationFrame(gameLoop);

    return () => cancelAnimationFrame(gameLoopRef.current);
  }, [status, spawnObject, terrain]);

  return (
    <div 
      className="relative w-full bg-[#000d1a] overflow-hidden flex flex-col font-sans select-none"
      style={{
        /* 100dvh adjusts for the iOS Safari address bar growing/shrinking */
        height: '100dvh',
        /* Prevent iOS from intercepting touch-scroll events during gameplay */
        touchAction: 'none',
      }}
      ref={containerRef}
      onMouseMove={handleMouseMove}
      onTouchMove={handleMouseMove}
      onTouchStart={handleMouseMove}
    >
      {/* Ocean — animated CSS ripple layers */}
      <div className="absolute inset-0 water-pattern opacity-80 pointer-events-none" />
      {/* Shimmer sweep across water surface */}
      <div className="absolute inset-0 water-shimmer pointer-events-none z-0" />
      {/* Bioluminescent deep glow */}
      <div className="absolute inset-0 deep-glow pointer-events-none z-0 transition-opacity duration-[5000ms]"
           style={{ opacity: weather === "fog" ? 0.3 : 1 }} />

      {/* Caustics — SVG blob layer 1 */}
      <svg className="absolute inset-[-12%] caustics-layer pointer-events-none z-0" style={{ opacity: weather === "fog" ? 0.04 : 1, width: "124%", height: "124%" }} viewBox="0 0 400 800" preserveAspectRatio="xMidYMid slice">
        <defs>
          <radialGradient id="cg1" cx="50%" cy="50%" r="50%"><stop offset="0%" stopColor="#0066cc" stopOpacity="0.35"/><stop offset="100%" stopColor="#0066cc" stopOpacity="0"/></radialGradient>
          <radialGradient id="cg2" cx="50%" cy="50%" r="50%"><stop offset="0%" stopColor="#00aaff" stopOpacity="0.25"/><stop offset="100%" stopColor="#00aaff" stopOpacity="0"/></radialGradient>
        </defs>
        <ellipse cx="120" cy="200" rx="90" ry="60"  fill="url(#cg1)"/>
        <ellipse cx="300" cy="500" rx="70" ry="50"  fill="url(#cg2)"/>
        <ellipse cx="200" cy="700" rx="110" ry="70" fill="url(#cg1)"/>
        <ellipse cx="60"  cy="620" rx="55" ry="40"  fill="url(#cg2)"/>
        <ellipse cx="350" cy="130" rx="80" ry="55"  fill="url(#cg1)"/>
      </svg>

      {/* Caustics — SVG blob layer 2 (slower drift) */}
      <svg className="absolute inset-[-8%] caustics-layer-2 pointer-events-none z-0" style={{ opacity: weather === "fog" ? 0.03 : 1, width: "116%", height: "116%" }} viewBox="0 0 400 800" preserveAspectRatio="xMidYMid slice">
        <ellipse cx="80"  cy="350" rx="100" ry="65" fill="url(#cg2)"/>
        <ellipse cx="320" cy="250" rx="75"  ry="50" fill="url(#cg1)"/>
        <ellipse cx="200" cy="550" rx="85"  ry="55" fill="url(#cg2)"/>
      </svg>
      
      {/* Top Atmosphere / Fog */}
      <div 
        className="absolute top-0 left-0 right-0 h-1/2 strait-fog z-50 pointer-events-none" 
        style={{ opacity: weather === "fog" ? 1 : 0.4 }}
      />

      {/* Dynamic Weather Overlays */}
      {weather === "rain" && (
        <div className="absolute inset-0 z-60 pointer-events-none overflow-hidden">
          {rainStreaks.map((s, i) => (
            <div 
              key={i} 
              className="rain-streak"
              style={s}
            />
          ))}
        </div>
      )}

      {weather === "fog" && (
        <div className="absolute inset-0 z-55 pointer-events-none overflow-hidden">
          {fogLayers.map((s, i) => (
            <div 
              key={i} 
              className="fog-layer"
              style={s}
            />
          ))}
        </div>
      )}

      {/* Low Health Vignette */}
      {health <= 35 && (
        <div className="absolute inset-0 pointer-events-none z-[80] shadow-[inset_0_0_150px_rgba(255,59,48,0.3)] animate-pulse" />
      )}

      {/* Terrain / Shorelines */}
      {terrain.map((slice) => {
        const hasTurret   = slice.id % 5 === 0;
        const hasBuilding = slice.id % 7 === 0;
        const hasTower    = slice.id % 11 === 0;
        const seed = slice.id * 17;
        const rockH1 = 8 + (seed % 14);
        const rockH2 = 6 + ((seed * 3) % 12);
        const rockH3 = 10 + ((seed * 7) % 10);
        return (
        <React.Fragment key={slice.id}>
          {/* ── Left Shore ── */}
          <div className="absolute z-10" style={{ left: 0, top: slice.y, width: slice.leftWidth, height: 42 }}>
            {/* Base land */}
            <div className="absolute inset-0" style={{
              background: "linear-gradient(to right, #0a0a08, #111209, #151510)",
              boxShadow: "8px 0 24px rgba(0,0,0,0.9)"
            }} />
            {/* Rock cliff edge — jagged SVG */}
            <svg className="absolute right-0 top-0 h-full" width="22" viewBox="0 0 22 42" preserveAspectRatio="none">
              <polygon points={`0,0 8,0 14,${rockH1} 22,${rockH2} 22,42 0,42`} fill="#1a1a14" />
              <polygon points={`4,0 12,0 18,${rockH3} 22,${rockH1+4} 22,42 8,42`} fill="#222218" opacity="0.7" />
              <line x1="22" y1="0" x2="22" y2="42" stroke="#2a2a20" strokeWidth="1.5" />
              {/* Water edge shimmer */}
              <line x1="21" y1="0" x2="21" y2="42" stroke="rgba(100,180,255,0.15)" strokeWidth="1" />
            </svg>
            {/* Desert scrub dots */}
            {[0.2,0.5,0.75].map((p,i) => (
              <div key={i} className="absolute rounded-full" style={{
                width: 3 + (seed*i % 4), height: 3 + (seed*i % 3),
                left: `${10 + (seed*(i+1) % 50)}%`, top: `${20 + (seed*i % 50)}%`,
                background: "#1e2010", opacity: 0.8
              }} />
            ))}
            {/* Oil refinery structure (every 7th) */}
            {hasBuilding && slice.leftWidth > 30 && (
              <svg className="absolute" style={{ left: Math.max(4, slice.leftWidth - 36), top: 2 }} width="28" height="36" viewBox="0 0 28 36">
                {/* Tank */}
                <rect x="2" y="14" width="14" height="18" rx="2" fill="#1c1c18" stroke="#2a2a20" strokeWidth="1"/>
                <ellipse cx="9" cy="14" rx="7" ry="3" fill="#222218"/>
                {/* Flare stack */}
                <rect x="20" y="6" width="3" height="26" fill="#1a1a14" stroke="#252520" strokeWidth="0.5"/>
                <ellipse cx="21.5" cy="6" rx="3" ry="2" fill="#ff6600" opacity="0.7"/>
                <ellipse cx="21.5" cy="5" rx="2" ry="1.5" fill="#ffaa00" opacity="0.5"/>
                {/* Pipe */}
                <line x1="16" y1="22" x2="20" y2="22" stroke="#333328" strokeWidth="2"/>
              </svg>
            )}
            {/* Turret (every 5th) */}
            {hasTurret && slice.leftWidth > 20 && (
              <svg className="absolute" style={{ left: slice.leftWidth - 28, top: 0 }} width="28" height="42" viewBox="0 0 28 42">
                {/* Base bunker */}
                <rect x="2" y="22" width="24" height="18" rx="1" fill="#1e1e18" stroke="#333328" strokeWidth="1"/>
                <rect x="4" y="20" width="20" height="6" rx="1" fill="#252520"/>
                {/* Turret dome */}
                <ellipse cx="14" cy="20" rx="10" ry="6" fill="#2a2a22" stroke="#3a3a30" strokeWidth="1"/>
                {/* Gun barrel */}
                <rect x="20" y="17" width="14" height="3" rx="1" fill="#333328" stroke="#444438" strokeWidth="0.5"/>
                {/* Muzzle */}
                <rect x="32" y="17.5" width="3" height="2" rx="0.5" fill="#555548"/>
                {/* Viewport slit */}
                <rect x="6" y="18" width="14" height="2" rx="1" fill="#111108"/>
                {/* Warning light */}
                <circle cx="14" cy="14" r="2" fill="#ff3300" opacity="0.9" className="animate-pulse"/>
              </svg>
            )}
            {/* Watchtower (every 11th) */}
            {hasTower && slice.leftWidth > 25 && (
              <svg className="absolute" style={{ left: slice.leftWidth - 20, top: -10 }} width="18" height="30" viewBox="0 0 18 30">
                <rect x="6" y="14" width="6" height="16" fill="#1a1a14" stroke="#2a2a20" strokeWidth="0.5"/>
                <rect x="2" y="10" width="14" height="6" rx="1" fill="#222218" stroke="#333328" strokeWidth="1"/>
                <rect x="4" y="8" width="10" height="4" rx="1" fill="#1e1e18"/>
                <rect x="5" y="10" width="3" height="3" fill="#0a1a0a" opacity="0.8"/>
                <rect x="10" y="10" width="3" height="3" fill="#0a1a0a" opacity="0.8"/>
                <line x1="9" y1="0" x2="9" y2="8" stroke="#333328" strokeWidth="1"/>
                <circle cx="9" cy="0" r="1.5" fill="#cc0000" opacity="0.8" className="animate-pulse"/>
              </svg>
            )}
          </div>

          {/* ── Right Shore ── */}
          <div className="absolute z-10" style={{ right: 0, top: slice.y, width: slice.rightWidth, height: 42 }}>
            {/* Base land */}
            <div className="absolute inset-0" style={{
              background: "linear-gradient(to left, #0a0a08, #111209, #151510)",
              boxShadow: "-8px 0 24px rgba(0,0,0,0.9)"
            }} />
            {/* Rock cliff edge */}
            <svg className="absolute left-0 top-0 h-full" width="22" viewBox="0 0 22 42" preserveAspectRatio="none">
              <polygon points={`22,0 14,0 8,${rockH2} 0,${rockH1} 0,42 22,42`} fill="#1a1a14" />
              <polygon points={`18,0 10,0 4,${rockH1} 0,${rockH3} 0,42 14,42`} fill="#222218" opacity="0.7" />
              <line x1="0" y1="0" x2="0" y2="42" stroke="#2a2a20" strokeWidth="1.5" />
              <line x1="1" y1="0" x2="1" y2="42" stroke="rgba(100,180,255,0.15)" strokeWidth="1" />
            </svg>
            {/* Desert scrub */}
            {[0.3,0.6,0.85].map((p,i) => (
              <div key={i} className="absolute rounded-full" style={{
                width: 3 + ((seed+5)*i % 4), height: 3 + ((seed+3)*i % 3),
                right: `${10 + ((seed+2)*(i+1) % 50)}%`, top: `${15 + ((seed+4)*i % 55)}%`,
                background: "#1e2010", opacity: 0.8
              }} />
            ))}
            {/* Oil structure */}
            {hasBuilding && slice.rightWidth > 30 && (
              <svg className="absolute" style={{ right: Math.max(4, slice.rightWidth - 36), top: 2 }} width="28" height="36" viewBox="0 0 28 36">
                <rect x="12" y="14" width="14" height="18" rx="2" fill="#1c1c18" stroke="#2a2a20" strokeWidth="1"/>
                <ellipse cx="19" cy="14" rx="7" ry="3" fill="#222218"/>
                <rect x="5" y="6" width="3" height="26" fill="#1a1a14" stroke="#252520" strokeWidth="0.5"/>
                <ellipse cx="6.5" cy="6" rx="3" ry="2" fill="#ff6600" opacity="0.7"/>
                <ellipse cx="6.5" cy="5" rx="2" ry="1.5" fill="#ffaa00" opacity="0.5"/>
                <line x1="12" y1="22" x2="8" y2="22" stroke="#333328" strokeWidth="2"/>
              </svg>
            )}
            {/* Turret */}
            {hasTurret && slice.rightWidth > 20 && (
              <svg className="absolute" style={{ right: slice.rightWidth - 28, top: 0 }} width="28" height="42" viewBox="0 0 28 42">
                <rect x="2" y="22" width="24" height="18" rx="1" fill="#1e1e18" stroke="#333328" strokeWidth="1"/>
                <rect x="4" y="20" width="20" height="6" rx="1" fill="#252520"/>
                <ellipse cx="14" cy="20" rx="10" ry="6" fill="#2a2a22" stroke="#3a3a30" strokeWidth="1"/>
                {/* Barrel pointing LEFT (into strait) */}
                <rect x="-6" y="17" width="14" height="3" rx="1" fill="#333328" stroke="#444438" strokeWidth="0.5"/>
                <rect x="-9" y="17.5" width="3" height="2" rx="0.5" fill="#555548"/>
                <rect x="8" y="18" width="14" height="2" rx="1" fill="#111108"/>
                <circle cx="14" cy="14" r="2" fill="#ff3300" opacity="0.9" className="animate-pulse"/>
              </svg>
            )}
            {/* Watchtower */}
            {hasTower && slice.rightWidth > 25 && (
              <svg className="absolute" style={{ right: slice.rightWidth - 20, top: -10 }} width="18" height="30" viewBox="0 0 18 30">
                <rect x="6" y="14" width="6" height="16" fill="#1a1a14" stroke="#2a2a20" strokeWidth="0.5"/>
                <rect x="2" y="10" width="14" height="6" rx="1" fill="#222218" stroke="#333328" strokeWidth="1"/>
                <rect x="4" y="8" width="10" height="4" rx="1" fill="#1e1e18"/>
                <rect x="5" y="10" width="3" height="3" fill="#0a1a0a" opacity="0.8"/>
                <rect x="10" y="10" width="3" height="3" fill="#0a1a0a" opacity="0.8"/>
                <line x1="9" y1="0" x2="9" y2="8" stroke="#333328" strokeWidth="1"/>
                <circle cx="9" cy="0" r="1.5" fill="#cc0000" opacity="0.8" className="animate-pulse"/>
              </svg>
            )}
          </div>
        </React.Fragment>
        );
      })}

      {/* Mission Toast */}
      <AnimatePresence>
        {showMissionToast && (
          <motion.div 
            initial={{ opacity: 0, y: -100 }}
            animate={{ opacity: 1, y: 30 }}
            exit={{ opacity: 0, scale: 0.8 }}
            className="absolute top-16 left-1/2 -translate-x-1/2 z-[200] pointer-events-none"
          >
            <div className="ios-card px-8 py-4 flex items-center gap-4 border-ios-green/30 shadow-[0_20px_50px_rgba(52,199,89,0.2)]">
              <div className="w-10 h-10 bg-ios-green/20 rounded-2xl flex items-center justify-center">
                <Settings className="w-6 h-6 text-ios-green animate-spin" />
              </div>
              <div className="flex flex-col">
                <span className="text-[10px] text-ios-green font-black uppercase tracking-[0.2em] mb-0.5">Objective Complete</span>
                <span className="text-lg font-black text-white leading-none">Mission Accomplished</span>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Compact HUD bar ── */}
      <div
        className="absolute left-0 right-0 z-[100] pointer-events-none"
        style={{ top: 'calc(env(safe-area-inset-top, 0px) + 6px)', padding: '0 10px' }}
      >
        {/* Single top strip: cash | hull | fuel | shield | mission | score */}
        <div className="ios-hud-bg rounded-2xl border border-white/5 shadow-xl flex items-center gap-2 px-3 py-1.5">

          {/* Cash */}
          <div className="flex flex-col items-center shrink-0">
            <div className="flex items-center gap-0.5">
              <Coins className="w-3 h-3 text-amber-400" />
              <span className="text-[11px] font-bold text-white">${cash}</span>
            </div>
            <span className="text-[7px] text-white/30 uppercase tracking-wide">Cash</span>
          </div>

          <div className="w-px h-6 bg-white/10 shrink-0" />

          {/* Hull integrity */}
          <div className="flex flex-col items-center shrink-0">
            <div className="flex items-center gap-1">
              <div className="w-14 h-1.5 bg-white/10 rounded-full overflow-hidden">
                <motion.div className="h-full rounded-full" animate={{ width: `${health}%` }}
                  style={{ backgroundColor: health > 50 ? "#34C759" : health > 25 ? "#FFD60A" : "#FF3B30" }} />
              </div>
              <span className="text-[9px] font-bold" style={{ color: health > 50 ? "#34C759" : health > 25 ? "#FFD60A" : "#FF3B30" }}>{Math.ceil(health)}%</span>
            </div>
            <span className="text-[7px] text-white/30 uppercase tracking-wide">Hull</span>
          </div>

          <div className="w-px h-6 bg-white/10 shrink-0" />

          {/* Fuel gauge */}
          <div className="flex flex-col items-center shrink-0">
            <div className="flex items-center gap-1">
              <div className="w-14 h-1.5 bg-white/10 rounded-full overflow-hidden">
                <motion.div className="h-full rounded-full" animate={{ width: `${fuel}%` }}
                  style={{ backgroundColor: fuel > 40 ? "#22c55e" : fuel > 20 ? "#f59e0b" : "#ef4444" }} />
              </div>
              {fuel <= 25
                ? <span className="text-[8px] text-red-400 font-black animate-pulse">LOW</span>
                : <span className="text-[9px] font-bold text-white/60">{Math.ceil(fuel)}%</span>}
            </div>
            <span className="text-[7px] text-white/30 uppercase tracking-wide">Fuel</span>
          </div>

          {/* Shield charges */}
          {shield > 0 && (
            <>
              <div className="w-px h-6 bg-white/10 shrink-0" />
              <div className="flex flex-col items-center shrink-0">
                <div className="flex items-center gap-0.5">
                  {[...Array(shield)].map((_, i) => (
                    <span key={i} className="text-[10px]">🛡️</span>
                  ))}
                </div>
                <span className="text-[7px] text-white/30 uppercase tracking-wide">Shield</span>
              </div>
            </>
          )}

          {/* Repair button — only when hurt */}
          {status === "playing" && health < INITIAL_HEALTH && cash >= 100 && (
            <button
              onClick={repairShip}
              className="pointer-events-auto flex flex-col items-center gap-0 px-2 py-0.5 rounded-lg bg-white/10 border border-white/15 active:scale-95 shrink-0"
            >
              <div className="flex items-center gap-0.5">
                <Settings className="w-2.5 h-2.5 text-white" />
                <span className="text-[9px] font-bold text-white">$100</span>
              </div>
              <span className="text-[7px] text-white/30 uppercase tracking-wide">Repair</span>
            </button>
          )}
          <div className="w-px h-6 bg-white/10 shrink-0" />

          {/* Mission */}
          <div className="flex-1 flex flex-col min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] font-bold text-white truncate">{MISSIONS[currentMissionIndex]?.title}</span>
              {missionTimer !== null && (
                <span className={`text-[10px] font-black shrink-0 ${missionTimer < 10 ? 'text-ios-red animate-pulse' : 'text-amber-400'}`}>
                  {missionTimer}s
                </span>
              )}
              <div className="w-10 h-1 bg-white/10 rounded-full overflow-hidden shrink-0">
                <motion.div
                className="h-full bg-ios-blue rounded-full"
                animate={{
                  width: `${Math.min(100, (
                    ["hazard","time_cargo","escort"].includes(MISSIONS[currentMissionIndex].type) ?
                      ((score - missionStartMetric) / MISSIONS[currentMissionIndex].target) * 100 :
                    MISSIONS[currentMissionIndex].type === "distance" ? (score / MISSIONS[currentMissionIndex].target) * 100 :
                    MISSIONS[currentMissionIndex].type === "cash" ? (cash / MISSIONS[currentMissionIndex].target) * 100 :
                    (tollsCompleted / MISSIONS[currentMissionIndex].target) * 100
                  ))}%`
                }}
              />
            </div>
            </div>
            <span className="text-[7px] text-white/30 uppercase tracking-wide">Mission</span>
          </div>

          <div className="w-px h-6 bg-white/10 shrink-0" />

          {/* Weather */}
          <div className="flex flex-col items-center shrink-0">
            <div>
              {weather === "rain" && <CloudRain className="w-3 h-3 text-sky-400" />}
              {weather === "fog"  && <Cloud className="w-3 h-3 text-slate-400" />}
              {weather === "clear" && <Wind className="w-3 h-3 text-white/30" />}
            </div>
            <span className="text-[7px] text-white/30 uppercase tracking-wide">
              {weather === "rain" ? "Rain" : weather === "fog" ? "Fog" : "Clear"}
            </span>
          </div>

          {/* Score */}
          <div className="flex flex-col items-center shrink-0">
            <div>
              <span className="text-[13px] font-black text-white">{score.toLocaleString()}</span>
              <span className="text-[8px] text-white/40 uppercase ml-0.5">NM</span>
            </div>
            <span className="text-[7px] text-white/30 uppercase tracking-wide">Distance</span>
          </div>
        </div>

        {/* Boost badge — separate small pill below */}
        {boostActive && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="mt-1 mx-auto w-fit ios-hud-bg rounded-xl border border-cyan-400/30 px-3 py-0.5 flex items-center gap-1.5"
          >
            <Wind className="w-3 h-3 text-cyan-400 animate-pulse" />
            <span className="text-[10px] font-bold text-cyan-400">BOOST</span>
            <span className="text-[10px] font-black text-cyan-400">{boostCountdown}s</span>
          </motion.div>
        )}
      </div>

      {/* Game Scene */}
      <div className="relative flex-1 bloom-container">
        {/* Escort Vessel */}
        <AnimatePresence>
          {MISSIONS[currentMissionIndex]?.type === "escort" && (
            <motion.div
              className="absolute bottom-[200px] z-30 flex flex-col items-center"
              animate={{ 
                x: tankerX + 100, 
                y: tankerYOffset + 20,
                opacity: 1,
                scale: 1
              }}
              style={{ rotate: tankerRotation * 0.8 }}
              initial={{ opacity: 0, scale: 0.8 }}
              exit={{ opacity: 0, scale: 0.8 }}
              transition={{ x: { type: "spring", damping: 20 }, y: { type: "tween", duration: 0.1 } }}
            >
              {/* Wake */}
              <div className="absolute -bottom-10 left-1/2 -translate-x-1/2 w-6 h-20 origin-top pointer-events-none z-0">
                <div className="absolute top-0 inset-x-0 h-full bg-gradient-to-b from-sky-400/30 to-transparent blur-md rounded-full" />
              </div>
              
              {/* Frigate Body */}
              <div className="w-[30px] h-[100px] relative z-10">
                <div className="absolute inset-0 bg-slate-700 rounded-t-[20px] rounded-b-md shadow-lg border-x-[2px] border-slate-600" />
                <div className="absolute top-[20px] left-1/2 -translate-x-1/2 w-[14px] h-[30px] bg-slate-800 rounded-sm" />
                {/* Turret */}
                <div className="absolute top-[10px] left-1/2 -translate-x-1/2 w-4 h-4 rounded-full bg-slate-900 border border-slate-600" />
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Realistic Tanker */}
        <motion.div
          className="absolute bottom-[80px] z-40 flex flex-col items-center tanker-glow"
          animate={{ 
            x: tankerX, 
            y: tankerYOffset,
            scale: status === "playing" ? 1 : 0.95 
          }}
          style={{ rotate: tankerRotation }}
          transition={{ 
            x: { type: "tween", duration: 0.1, ease: "linear" }, 
            y: { type: "tween", duration: 0.1, ease: "linear" },
            scale: { duration: 0.3 }
          }}
        >
          {/* Water Wake / Trail */}
          <div className="absolute -bottom-16 left-1/2 -translate-x-1/2 w-10 h-40 origin-top pointer-events-none z-0">
             <div className="absolute top-0 inset-x-0 h-full bg-gradient-to-b from-sky-400/40 via-sky-400/10 to-transparent blur-xl rounded-full" />
             {/* Port Wake */}
             <div className="absolute top-0 -left-[50px] w-12 h-32 rotate-[25deg] origin-top-right bg-gradient-to-b from-white/30 to-transparent blur-lg rounded-full animate-pulse" />
             {/* Starboard Wake */}
             <div className="absolute top-0 -right-[50px] w-12 h-32 -rotate-[25deg] origin-top-left bg-gradient-to-b from-white/30 to-transparent blur-lg rounded-full animate-pulse" style={{ animationDelay: '200ms' }} />
          </div>

          {/* Engine Boost Visual */}
          {boostActive && (
            <div className="absolute -bottom-8 left-1/2 -translate-x-1/2 w-6 h-16 origin-top pointer-events-none z-10 flex justify-center">
              <motion.div 
                animate={{ scaleY: [1, 1.5, 1], opacity: [0.8, 1, 0.8] }}
                transition={{ repeat: Infinity, duration: 0.1 }}
                className="w-full h-full bg-gradient-to-b from-cyan-300 via-blue-500 to-transparent blur-sm rounded-full"
              />
              <motion.div 
                className="absolute top-0 w-2 h-10 bg-white blur-[1px] rounded-full"
                animate={{ scaleY: [1, 1.2, 1] }}
                transition={{ repeat: Infinity, duration: 0.05 }}
              />
            </div>
          )}

          {/* Tanker Body — SVG VLCC */}
          <div className="w-[38px] h-[120px] relative z-10">
              <svg width="38" height="120" viewBox="0 0 50 160" xmlns="http://www.w3.org/2000/svg" style={{position:'absolute',inset:0,overflow:'visible'}} preserveAspectRatio="xMidYMid meet">
                <defs>
                  <radialGradient id="hullGrad" cx="30%" cy="20%" r="80%">
                    <stop offset="0%" stopColor="#334155"/>
                    <stop offset="100%" stopColor="#0f172a"/>
                  </radialGradient>
                  <radialGradient id="deckGradCrude" cx="40%" cy="15%" r="80%">
                    <stop offset="0%" stopColor="#7f1d1d"/>
                    <stop offset="100%" stopColor="#1c0505"/>
                  </radialGradient>
                  <radialGradient id="deckGradLng" cx="40%" cy="15%" r="80%">
                    <stop offset="0%" stopColor="#e2e8f0"/>
                    <stop offset="100%" stopColor="#94a3b8"/>
                  </radialGradient>
                  <radialGradient id="deckGradChem" cx="40%" cy="15%" r="80%">
                    <stop offset="0%" stopColor="#164e63"/>
                    <stop offset="100%" stopColor="#0a2535"/>
                  </radialGradient>
                  <radialGradient id="sphereGrad" cx="30%" cy="25%" r="70%">
                    <stop offset="0%" stopColor="#f1f5f9"/>
                    <stop offset="100%" stopColor="#94a3b8"/>
                  </radialGradient>
                  <filter id="glow"><feGaussianBlur stdDeviation="1.5" result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
                </defs>

                {/* Hull outer */}
                <path d="M8 18 Q25 2 42 18 L42 148 Q25 158 8 148 Z" fill="url(#hullGrad)"/>
                {/* Hull sheen */}
                <path d="M10 18 Q25 6 40 18 L40 50 Q25 42 10 50 Z" fill="white" fillOpacity="0.05"/>
                {/* Hull shadow edge */}
                <path d="M8 18 Q25 2 42 18" fill="none" stroke="#1e3a5f" strokeWidth="2"/>

                {/* Deck */}
                {cargoType === "crude" && (
                  <>
                    <path d="M12 22 Q25 8 38 22 L38 140 Q25 148 12 140 Z" fill="url(#deckGradCrude)"/>
                    {/* Walkway */}
                    <rect x="23" y="22" width="4" height="108" fill="#0f172a" fillOpacity="0.6"/>
                    {/* Hatches */}
                    {[35,58,81,104].map(y => (
                      <g key={y}>
                        <rect x="14" y={y} width="22" height="14" rx="1" fill="#000" fillOpacity="0.35"/>
                        <rect x="14" y={y} width="22" height="2" fill="white" fillOpacity="0.04"/>
                        <circle cx="16" cy={y+3} r="1" fill="white" fillOpacity="0.15"/>
                      </g>
                    ))}
                    {/* Pipe manifold */}
                    <rect x="13" y="25" width="10" height="108" fill="none" stroke="#374151" strokeWidth="0.5" strokeDasharray="4,4"/>
                    <rect x="27" y="25" width="10" height="108" fill="none" stroke="#374151" strokeWidth="0.5" strokeDasharray="4,4"/>
                  </>
                )}
                {cargoType === "lng" && (
                  <>
                    <path d="M12 22 Q25 8 38 22 L38 140 Q25 148 12 140 Z" fill="url(#deckGradLng)"/>
                    <rect x="23" y="22" width="4" height="80" fill="#94a3b8" fillOpacity="0.5"/>
                    {[28,55,82,109].map(y => (
                      <g key={y}>
                        <circle cx="25" cy={y} r="10" fill="url(#sphereGrad)"/>
                        <circle cx="22" cy={y-3} r="3" fill="white" fillOpacity="0.55"/>
                        <circle cx="25" cy={y} r="10" fill="none" stroke="#cbd5e1" strokeWidth="0.5"/>
                      </g>
                    ))}
                  </>
                )}
                {cargoType === "chemicals" && (
                  <>
                    <path d="M12 22 Q25 8 38 22 L38 140 Q25 148 12 140 Z" fill="url(#deckGradChem)"/>
                    {[28,50,72,94,116].map(y => (
                      <g key={y}>
                        <rect x="14" y={y} width="9" height="18" rx="2" fill="#0e7490"/>
                        <rect x="14" y={y} width="4" height="18" rx="2" fill="white" fillOpacity="0.35"/>
                        <rect x="27" y={y} width="9" height="18" rx="2" fill="#0e7490"/>
                        <rect x="27" y={y} width="4" height="18" rx="2" fill="white" fillOpacity="0.35"/>
                      </g>
                    ))}
                  </>
                )}

                {/* Deck lights */}
                {[[14,42],[36,42],[14,90],[36,90],[14,125],[36,125]].map(([lx,ly],i) => (
                  <circle key={i} cx={lx} cy={ly} r="1.5" fill="#fde047" filter="url(#glow)" className="deck-light"/>
                ))}

                {/* Lifeboats */}
                <rect x="9" y="120" width="5" height="12" rx="2.5" fill="#ea580c"/>
                <rect x="36" y="120" width="5" height="12" rx="2.5" fill="#ea580c"/>

                {/* Bridge superstructure */}
                <rect x="10" y="130" width="30" height="28" rx="2" fill="#d1d5db"/>
                <rect x="10" y="130" width="30" height="2"  rx="1" fill="white" fillOpacity="0.3"/>
                {/* Bridge windows */}
                {[13,17,21,25,29,33].map((wx,i) => (
                  <rect key={i} x={wx} y="132" width="3" height="5" rx="0.5" fill="#0ea5e9" fillOpacity="0.35"/>
                ))}
                {/* Funnel */}
                <rect x="21" y="122" width="8" height="10" rx="1" fill="#1e293b"/>
                <rect x="22" y="122" width="3" height="10" rx="1" fill="white" fillOpacity="0.08"/>

                {/* Radar arm (animated via CSS) */}
                <g className="radar-arm" style={{transformOrigin:'25px 136px'}}>
                  <line x1="25" y1="136" x2="25" y2="131" stroke="#0ea5e9" strokeWidth="1" strokeOpacity="0.8"/>
                </g>

                {/* Bow tip */}
                <ellipse cx="25" cy="8" rx="5" ry="3" fill="#0f172a" fillOpacity="0.7"/>
              </svg>

              {/* Hull Shape — keep for collision/layout (transparent) */}
              <div className="absolute inset-0 rounded-t-[42px] rounded-b-xl" />
              
              {/* Damage overlays — smoke & fire over the SVG tanker */}
              {health <= 70 && (
                <div className="absolute top-[35%] left-1/2 -translate-x-1/2 w-full h-12 pointer-events-none z-50">
                  {[...Array(health <= 30 ? 5 : 3)].map((_, i) => (
                    <div key={i} className="absolute w-6 h-6 rounded-full smoke-fx" style={{ left: `${15 + i * 16}%`, animationDelay: `${i * 0.3}s` }} />
                  ))}
                  {health <= 30 && (
                    <>
                      <div className="absolute top-[8px] left-[28%] w-4 h-4 rounded-full fire-fx" style={{ animationDelay: '0s' }} />
                      <div className="absolute top-[4px] left-[50%] w-3 h-3 rounded-full fire-fx" style={{ animationDelay: '0.2s' }} />
                    </>
                  )}
                </div>
              )}

              {/* Steam from funnel */}
              {status === "playing" && (
                <div className="absolute top-[74px] left-1/2 -translate-x-1/2 flex gap-1 pointer-events-none z-20">
                  {[0,1,2].map(i => (
                    <motion.div key={i} className="w-2 h-2 bg-white/35 rounded-full blur-sm steam-particle" style={{ animationDelay: `${i * 0.9}s` }} />
                  ))}
                </div>
              )}

              {/* Navigation Radar Ping */}
              {status === "playing" && (
                <motion.div 
                   animate={{ scale: [1, 2.5], opacity: [0.3, 0] }}
                   transition={{ repeat: Infinity, duration: 2, ease: "easeOut" }}
                   className="absolute bottom-6 left-1/2 -translate-x-1/2 w-8 h-8 rounded-full border border-sky-400/30"
                />
              )}

              {/* Bow Tip Detail */}
              <div className="absolute top-[2px] left-1/2 -translate-x-1/2 w-4 h-[6px] bg-slate-950 rounded-full opacity-60" />
              
              {/* Wake Effects - Dynamic */}
              {status === "playing" && (
                <div className="absolute -bottom-20 left-1/2 -translate-x-1/2 flex gap-8">
                  <motion.div 
                    animate={{ opacity: [0.1, 0.4, 0.1], scaleY: [1, 1.2, 1] }}
                    transition={{ repeat: Infinity, duration: 1 }}
                    className="w-10 h-40 bg-gradient-to-t from-transparent via-white/10 to-transparent rounded-full blur-3xl"
                  />
                </div>
              )}

              {/* Shore Collision Sparks/Atmospheric Burn */}
              {(currentXRef.current <= (terrain.find(s => s.y > tankerY - 20 && s.y < tankerY + 180)?.leftWidth || 0) || 
                currentXRef.current >= (containerWidth - (terrain.find(s => s.y > tankerY - 20 && s.y < tankerY + 180)?.rightWidth || 0)) - TANKER_WIDTH) && status === "playing" && (
                <div className="absolute inset-0 z-50">
                   <motion.div 
                      animate={{ opacity: [0, 1, 0], scale: [1, 1.5, 1] }}
                      transition={{ repeat: Infinity, duration: 0.1 }}
                      className="absolute inset-0 bg-red-600/20 blur-2xl rounded-full"
                   />
                   <motion.div 
                      animate={{ y: [0, 20], x: [0, (Math.random()-0.5)*10], opacity: [1, 0] }}
                      transition={{ repeat: Infinity, duration: 0.2 }}
                      className="absolute top-0 left-1/2 w-1 h-4 bg-orange-400 blur-[1px]"
                   />
                </div>
              )}
          </div>
        </motion.div>

        {/* Objects with enhanced lighting */}
        {objects.map((obj) => (
          <div
            key={obj.id}
            className="absolute z-30 transition-opacity duration-1000"
            style={{ 
              left: obj.x, 
              top: obj.y, 
              width: obj.width, 
              height: obj.height,
              opacity: weather === "fog" ? 0.3 : 1,
              filter: weather === "fog" ? "blur(2px)" : "none"
            }}
          >
            {obj.type === "mine" ? (
              <div className="w-full h-full relative mine-bob">
                {/* Glow halo */}
                <div className="absolute inset-[-40%] bg-red-600/15 rounded-full blur-2xl animate-pulse pointer-events-none" />
                <svg width="100%" height="100%" viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg" style={{overflow:'visible'}}>
                  <defs>
                    <radialGradient id="mineGrad" cx="35%" cy="30%" r="65%">
                      <stop offset="0%" stopColor="#374151"/>
                      <stop offset="100%" stopColor="#030712"/>
                    </radialGradient>
                    <radialGradient id="mineCore" cx="50%" cy="50%" r="50%">
                      <stop offset="0%" stopColor="#fca5a5"/>
                      <stop offset="100%" stopColor="#ef4444"/>
                    </radialGradient>
                  </defs>
                  {/* Spikes */}
                  {[0,45,90,135,180,225,270,315].map((angle,i) => {
                    const rad = angle * Math.PI / 180;
                    return <line key={i} x1={20 + Math.cos(rad)*14} y1={20 + Math.sin(rad)*14} x2={20 + Math.cos(rad)*20} y2={20 + Math.sin(rad)*20} stroke="#6b7280" strokeWidth="2" strokeLinecap="round"/>;
                  })}
                  {/* Body */}
                  <circle cx="20" cy="20" r="13" fill="url(#mineGrad)" stroke="#1f2937" strokeWidth="1.5"/>
                  {/* Sheen */}
                  <ellipse cx="15" cy="14" rx="5" ry="4" fill="white" fillOpacity="0.08"/>
                  {/* Core blinker */}
                  <circle cx="20" cy="20" r="3" fill="url(#mineCore)" style={{filter:'drop-shadow(0 0 4px #ef4444)'}}/>
                </svg>
              </div>
            ) : obj.type === "levy" ? (
              <div className="w-[80vw] -translate-x-[calc(40vw-25px)] h-full flex items-center">
                 {/* Left Post */}
                 <div className="w-6 h-full bg-slate-800 border-2 border-amber-500 rounded-sm shadow-lg flex items-center justify-center">
                    <div className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
                 </div>
                 
                 {/* The Gate Beam */}
                 <div className="flex-1 h-3 relative">
                    <div className="absolute inset-x-0 -top-[100px] h-[100px] bg-gradient-to-b from-transparent to-amber-500/10 pointer-events-none" />
                    <motion.div 
                      className="absolute inset-x-0 -top-1 h-8 bg-gradient-to-b from-green-500/40 to-transparent blur-md pointer-events-none"
                      animate={{ y: [0, 80, 0] }}
                      transition={{ duration: 2, ease: "linear", repeat: Infinity }}
                    />
                    <div className="absolute inset-0 bg-amber-500/40 backdrop-blur-sm border-y border-amber-400 shadow-[0_0_20px_rgba(245,158,11,0.5)]" />
                    <div className="h-full bg-gradient-to-r from-transparent via-amber-400 to-transparent opacity-80 animate-pulse" />
                    <div className="absolute inset-0 flex items-center justify-around px-10">
                       <span className="text-[6px] text-amber-900 font-black tracking-widest">AUTHORIZED PERSONNEL ONLY</span>
                       <span className="text-[6px] text-amber-900 font-black tracking-widest">TOLL ZONE</span>
                       <span className="text-[6px] text-amber-900 font-black tracking-widest">AUTHORIZED PERSONNEL ONLY</span>
                    </div>
                 </div>

                 {/* Right Post */}
                 <div className="w-6 h-full bg-slate-800 border-2 border-amber-500 rounded-sm shadow-lg flex items-center justify-center">
                    <div className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
                 </div>
              </div>
            ) : obj.type === "boost" ? (
                <div className="w-full h-full relative group">
                    <div className="absolute bottom-1/2 left-1/2 -translate-x-1/2 w-8 h-40 bg-gradient-to-t from-cyan-400/30 to-transparent blur-xl" />
                    <Wind className="w-full h-full text-cyan-400 drop-shadow-[0_0_15px_rgba(34,211,238,0.8)] animate-pulse" />
                    <div className="absolute inset-0 bg-cyan-400/20 rounded-full blur-2xl scale-200 animate-pulse" />
                </div>
            ) : obj.type === "fuel" ? (
                <div className="w-full h-full relative flex items-center justify-center">
                    <div className="absolute inset-0 bg-amber-400/20 rounded-full blur-xl animate-pulse" />
                    <div className="absolute bottom-1/2 left-1/2 -translate-x-1/2 w-6 h-32 bg-gradient-to-t from-amber-400/40 to-transparent blur-lg" />
                    <svg width="30" height="30" viewBox="0 0 30 30" className="animate-bounce drop-shadow-[0_0_8px_rgba(251,191,36,0.9)]">
                      <rect x="4" y="8" width="16" height="18" rx="2" fill="#f59e0b"/>
                      <rect x="6" y="5" width="5" height="5" rx="1" fill="#d97706"/>
                      <rect x="11" y="3" width="3" height="4" rx="1" fill="#92400e"/>
                      <rect x="20" y="10" width="5" height="8" rx="1" fill="#d97706"/>
                      <rect x="7" y="14" width="10" height="2" rx="1" fill="white" fillOpacity="0.4"/>
                    </svg>
                    <span className="absolute -bottom-4 left-1/2 -translate-x-1/2 text-[8px] font-black text-amber-400 whitespace-nowrap">FUEL</span>
                </div>
            ) : obj.type === "shield" ? (
                <div className="w-full h-full relative flex items-center justify-center">
                    <div className="absolute inset-0 bg-blue-400/20 rounded-full blur-xl animate-pulse" />
                    <div className="absolute bottom-1/2 left-1/2 -translate-x-1/2 w-6 h-32 bg-gradient-to-t from-blue-400/40 to-transparent blur-lg" />
                    <svg width="30" height="30" viewBox="0 0 30 30" className="animate-pulse drop-shadow-[0_0_10px_rgba(96,165,250,0.9)]">
                      <path d="M15 3 L26 8 L26 16 Q26 24 15 28 Q4 24 4 16 L4 8 Z" fill="#3b82f6" fillOpacity="0.9"/>
                      <path d="M15 6 L23 10 L23 16 Q23 22 15 25 Q7 22 7 16 L7 10 Z" fill="#60a5fa" fillOpacity="0.5"/>
                      <path d="M11 15 L14 18 L20 12" stroke="white" strokeWidth="2" strokeLinecap="round" fill="none"/>
                    </svg>
                    <span className="absolute -bottom-4 left-1/2 -translate-x-1/2 text-[8px] font-black text-blue-400 whitespace-nowrap">SHIELD</span>
                </div>
            ) : (
                <div className="w-full h-full relative group">
                    <div className="absolute bottom-1/2 left-1/2 -translate-x-1/2 w-8 h-40 bg-gradient-to-t from-ios-green/30 to-transparent blur-xl" />
                    <Coins className="w-full h-full text-ios-green drop-shadow-[0_0_15px_rgba(52,199,89,0.8)] animate-bounce" />
                    <div className="absolute inset-0 bg-ios-green/10 rounded-full blur-3xl scale-250 animate-pulse" />
                </div>
            )}
          </div>
        ))}

        {/* Explosions */}
        <AnimatePresence>
          {explosions.map((exp) => (
            <motion.div
              key={exp.id}
              className="absolute z-50 pointer-events-none"
              style={{ left: exp.x - 55, top: exp.y - 55, width: 110, height: 110 }}
              initial={{ opacity: 1 }}
              animate={{ opacity: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.9, ease: "easeOut" }}
            >
              <svg width="110" height="110" viewBox="0 0 110 110" style={{ overflow: "visible" }}>
                <defs>
                  <radialGradient id={`expCore${exp.id}`} cx="50%" cy="50%" r="50%">
                    <stop offset="0%"   stopColor="#ffffff"/>
                    <stop offset="25%"  stopColor="#ffff88"/>
                    <stop offset="55%"  stopColor="#ff8800"/>
                    <stop offset="100%" stopColor="transparent"/>
                  </radialGradient>
                  <radialGradient id={`expRing${exp.id}`} cx="50%" cy="50%" r="50%">
                    <stop offset="50%"  stopColor="#ff4400" stopOpacity="0.7"/>
                    <stop offset="100%" stopColor="transparent"/>
                  </radialGradient>
                </defs>
                <motion.circle cx="55" cy="55" r="10"
                  fill="none" stroke="#ff8800" strokeWidth="3" strokeOpacity="0.6"
                  animate={{ r: [10, 54], strokeOpacity: [0.7, 0], strokeWidth: [3, 1] }}
                  transition={{ duration: 0.8, ease: "easeOut" }}
                />
                <motion.circle cx="55" cy="55" r="8"
                  fill="none" stroke="#ffdd00" strokeWidth="2" strokeOpacity="0.5"
                  animate={{ r: [8, 38], strokeOpacity: [0.6, 0] }}
                  transition={{ duration: 0.55, ease: "easeOut" }}
                />
                <motion.circle cx="55" cy="55" r="6"
                  fill={`url(#expRing${exp.id})`}
                  animate={{ r: [6, 32], opacity: [0.9, 0] }}
                  transition={{ duration: 0.6, ease: "easeOut" }}
                />
                <motion.circle cx="55" cy="55" r="4"
                  fill={`url(#expCore${exp.id})`}
                  animate={{ r: [4, 18], opacity: [1, 0] }}
                  transition={{ duration: 0.35, ease: "easeOut" }}
                />
                {[0,45,90,135,180,225,270,315].map((angle, i) => {
                  const rad = angle * Math.PI / 180;
                  return (
                    <motion.line key={i}
                      x1="55" y1="55"
                      x2={55 + Math.cos(rad) * 10} y2={55 + Math.sin(rad) * 10}
                      stroke={i % 2 === 0 ? "#ffdd00" : "#ff6600"} strokeWidth="1.5" strokeLinecap="round"
                      animate={{
                        x2: [55 + Math.cos(rad) * 10, 55 + Math.cos(rad) * 50],
                        y2: [55 + Math.sin(rad) * 10, 55 + Math.sin(rad) * 50],
                        opacity: [1, 0]
                      }}
                      transition={{ duration: 0.7, ease: "easeOut" }}
                    />
                  );
                })}
              </svg>
              <motion.div
                className="absolute inset-0 rounded-full"
                style={{ background: "radial-gradient(circle, rgba(255,140,0,0.6) 0%, transparent 70%)", filter: "blur(12px)" }}
                animate={{ scale: [0.5, 2.5], opacity: [0.8, 0] }}
                transition={{ duration: 0.6, ease: "easeOut" }}
              />
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {/* ── IAP Modal ─────────────────────────────────────────────────── */}
      <AnimatePresence>
        {showIAP && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-[200] bg-black/80 backdrop-blur-xl flex items-center justify-center p-6"
          >
            <motion.div
              initial={{ scale: 0.85, y: 40 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.85, y: 40 }}
              className="ios-card w-full max-w-sm rounded-3xl overflow-hidden"
            >
              {/* Header */}
              <div className="relative px-6 pt-8 pb-4 text-center"
                   style={{ background: iapReason === "fuel" ? "linear-gradient(to bottom, rgba(251,191,36,0.15), transparent)" : "linear-gradient(to bottom, rgba(96,165,250,0.15), transparent)" }}>
                <div className="text-5xl mb-3">{iapReason === "fuel" ? "⛽" : "🛡️"}</div>
                <h2 className="text-xl font-black text-white mb-1">
                  {iapReason === "fuel" ? "You're Out of Fuel!" : "Take a Hit — Shield Up!"}
                </h2>
                <p className="text-sm text-white/60 leading-snug">
                  {iapReason === "fuel"
                    ? "Your tanker has run dry in the Strait of Hormuz. Refuel now and keep the world's energy supply moving."
                    : "Mines are closing in. A shield will absorb the next hit and keep your hull intact."}
                </p>
              </div>

              {/* Products */}
              <div className="px-6 pb-2 flex flex-col gap-3">
                {/* Fuel pack */}
                <button
                  onClick={() => { setShowIAP(false); alert("Purchase: Fuel Pack — connect to App Store StoreKit"); }}
                  className="pointer-events-auto w-full rounded-2xl px-4 py-3 flex items-center gap-4 border border-amber-400/30 active:scale-95 transition-transform"
                  style={{ background: "linear-gradient(135deg, rgba(251,191,36,0.18), rgba(251,191,36,0.06))" }}
                >
                  <span className="text-3xl">⛽</span>
                  <div className="flex-1 text-left">
                    <div className="text-sm font-black text-white">Fuel Pack</div>
                    <div className="text-[11px] text-white/50">Refills your tank to 100% instantly</div>
                  </div>
                  <div className="text-right">
                    <div className="text-base font-black text-amber-400">$0.99</div>
                    <div className="text-[9px] text-white/30">AUD</div>
                  </div>
                </button>

                {/* Shield pack */}
                <button
                  onClick={() => { setShowIAP(false); alert("Purchase: Shield Pack — connect to App Store StoreKit"); }}
                  className="pointer-events-auto w-full rounded-2xl px-4 py-3 flex items-center gap-4 border border-blue-400/30 active:scale-95 transition-transform"
                  style={{ background: "linear-gradient(135deg, rgba(96,165,250,0.18), rgba(96,165,250,0.06))" }}
                >
                  <span className="text-3xl">🛡️</span>
                  <div className="flex-1 text-left">
                    <div className="text-sm font-black text-white">Armour Pack</div>
                    <div className="text-[11px] text-white/50">3 shield charges — absorb 3 mine hits</div>
                  </div>
                  <div className="text-right">
                    <div className="text-base font-black text-blue-400">$1.99</div>
                    <div className="text-[9px] text-white/30">AUD</div>
                  </div>
                </button>

                {/* Bundle */}
                <button
                  onClick={() => { setShowIAP(false); alert("Purchase: Survival Bundle — connect to App Store StoreKit"); }}
                  className="pointer-events-auto w-full rounded-2xl px-4 py-3 flex items-center gap-4 border border-white/20 active:scale-95 transition-transform relative overflow-hidden"
                  style={{ background: "linear-gradient(135deg, rgba(255,255,255,0.10), rgba(255,255,255,0.04))" }}
                >
                  <div className="absolute top-1.5 right-2 bg-ios-green text-black text-[8px] font-black px-1.5 py-0.5 rounded-full">BEST VALUE</div>
                  <span className="text-3xl">🚢</span>
                  <div className="flex-1 text-left">
                    <div className="text-sm font-black text-white">Survival Bundle</div>
                    <div className="text-[11px] text-white/50">Full fuel + 3 shields + $500 cash</div>
                  </div>
                  <div className="text-right">
                    <div className="text-base font-black text-white">$2.99</div>
                    <div className="text-[9px] text-white/30">AUD</div>
                  </div>
                </button>
              </div>

              {/* Dismiss */}
              <div className="px-6 pb-8 pt-2">
                <button
                  onClick={() => setShowIAP(false)}
                  className="pointer-events-auto w-full py-3 rounded-2xl text-white/40 text-sm font-bold active:text-white/70"
                >
                  No thanks, end run
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Overlays remain mostly same but updated text */}
      <AnimatePresence>
        {status === "start" && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-[100] bg-black/70 backdrop-blur-xl flex items-center justify-center p-8 text-center"
          >
            <div className="ios-card p-10 max-w-sm w-full shadow-2xl border border-white/10">
              <div className="bg-ios-blue/20 w-16 h-16 rounded-3xl flex items-center justify-center mx-auto mb-6">
                <Anchor className="w-8 h-8 text-ios-blue" />
              </div>
              <h1 className="text-3xl font-black text-white mb-2 leading-none">Hormuz Pass</h1>
              <p className="text-white/50 text-xs mb-6 leading-relaxed font-medium">
                Command a Deep-Sea Tanker through the world's most dangerous energy bottleneck. Avoid the literal rocky shores and hostile mines.
              </p>
              
              <div className="flex gap-2 mb-8 justify-center overflow-x-auto pb-2 px-2 mask-edges">
                {(["crude", "lng", "chemicals"] as CargoType[]).map((type) => (
                  <button
                    key={type}
                    onClick={() => setCargoType(type)}
                    className={`flex flex-col items-center gap-2 p-3 rounded-xl border transition-all ${cargoType === type ? 'border-ios-blue bg-ios-blue/20' : 'border-white/10 bg-black/40 opacity-60'}`}
                  >
                    <span className="text-[10px] font-bold uppercase whitespace-nowrap">{CARGO_STATS[type].name}</span>
                  </button>
                ))}
              </div>

              <div className="flex flex-col gap-2">
                <button 
                  onClick={startGame}
                  className="ios-btn w-full py-4 text-lg shadow-xl shadow-ios-blue/20 flex items-center justify-center gap-3 active:scale-95 transition-transform"
                >
                  Start Mission
                </button>

                <div className="flex items-center gap-2">
                  <button 
                    onClick={() => setShowUpgrades(true)}
                    className="flex-1 ios-glass py-3 rounded-xl border border-white/5 text-xs font-bold text-white flex items-center justify-center gap-2 active:scale-95 transition-transform"
                  >
                    <Settings className="w-4 h-4 text-green-400" />
                    Upgrades
                  </button>
                  <button 
                    onClick={() => setShowLeaderboard(true)}
                    className="flex-1 ios-glass py-3 rounded-xl border border-white/5 text-xs font-bold text-white flex items-center justify-center gap-2 active:scale-95 transition-transform"
                  >
                    <Trophy className="w-4 h-4 text-yellow-400" />
                    Ranks
                  </button>
                </div>
                
                {user ? (
                  <button 
                    onClick={logout}
                    className="ios-glass py-3 rounded-xl border border-white/5 text-xs font-bold text-white/50 flex items-center justify-center active:scale-95 transition-transform"
                    title="Sign Out"
                  >
                    <LogOut className="w-4 h-4 mr-2" />
                    Sign Out ({user.displayName || user.email})
                  </button>
                ) : (
                  <button 
                    onClick={loginWithGoogle}
                    className="ios-glass py-3 rounded-xl border border-white/5 text-xs font-bold text-white flex items-center justify-center gap-2 active:scale-95 transition-transform bg-white/5"
                  >
                    <LogIn className="w-4 h-4" />
                    Sign in to rank
                  </button>
                )}
              </div>
            </div>
          </motion.div>
        )}

        {/* Upgrades Modal */}
        {showUpgrades && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-[200] bg-black/80 backdrop-blur-xl flex flex-col p-4 sm:p-8"
          >
            <div className="flex items-center justify-between mb-8 mt-4">
               <div>
                 <h2 className="text-3xl font-black text-white flex items-center gap-3">
                   <Settings className="w-8 h-8 text-green-400" />
                   Shipyard Upgrades
                 </h2>
                 <p className="text-white/50 text-sm mt-1">Enhance your vessel. Bank Balance: <span className="text-green-400 font-bold">${bankBalance.toLocaleString()}</span></p>
               </div>
               <button 
                 onClick={() => setShowUpgrades(false)}
                 className="p-3 bg-white/10 rounded-full hover:bg-white/20 transition-colors"
               >
                 <X className="w-6 h-6 text-white" />
               </button>
            </div>

            <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar">
              <div className="flex flex-col gap-4">
                {[
                  { key: 'hull' as keyof Upgrades, name: "Reinforced Hull", desc: "+20 Max Integrity", icon: <Shield className="w-6 h-6 text-blue-400" /> },
                  { key: 'engine' as keyof Upgrades, name: "Engine Tuning", desc: "+5% Base Speed", icon: <Wind className="w-6 h-6 text-orange-400" /> },
                  { key: 'toll' as keyof Upgrades, name: "Toll Negotiator", desc: "-10% Toll Fees", icon: <Coins className="w-6 h-6 text-yellow-400" /> },
                  { key: 'funds' as keyof Upgrades, name: "Investment Portfolio", desc: "+$200 Starting Funds", icon: <Banknote className="w-6 h-6 text-green-400" /> },
                ].map((upg) => {
                  const level = upgrades[upg.key];
                  const cost = 500 * (level + 1);
                  const maxed = level >= 5;
                  const canAfford = bankBalance >= cost;

                  return (
                    <div key={upg.key} className="ios-glass p-5 rounded-2xl flex items-center gap-4 border border-white/5">
                       <div className="bg-white/5 p-3 rounded-xl border border-white/10">
                         {upg.icon}
                       </div>
                       <div className="flex-1">
                          <div className="text-base font-bold text-white mb-1">{upg.name} <span className="text-[10px] bg-white/10 px-2 py-0.5 rounded-full ml-2">LVL {level}/5</span></div>
                          <div className="text-[11px] text-white/50 leading-tight">{upg.desc} per level.</div>
                       </div>
                       <button
                         onClick={() => buyUpgrade(upg.key)}
                         disabled={maxed || !canAfford}
                         className={`px-4 py-2 rounded-xl text-xs font-bold transition-all border ${
                           maxed ? "bg-black/40 text-white/30 border-white/5" :
                           canAfford ? "bg-green-500/20 text-green-400 border-green-500/30 hover:bg-green-500/30 active:scale-95" :
                           "bg-red-500/10 text-red-400 border-red-500/20 opacity-50"
                         }`}
                       >
                         {maxed ? "MAXED" : `UPGRADE ($${cost})`}
                       </button>
                    </div>
                  );
                })}
              </div>
            </div>
          </motion.div>
        )}

        {/* Leaderboard Modal */}
        {showLeaderboard && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-[200] bg-black/80 backdrop-blur-xl flex flex-col p-4 sm:p-8"
          >
            <div className="flex items-center justify-between mb-8 mt-4">
               <div>
                 <h2 className="text-3xl font-black text-white flex items-center gap-3">
                   <Trophy className="w-8 h-8 text-yellow-400" />
                   Global Rankings
                 </h2>
                 <p className="text-white/50 text-sm mt-1">Top captains in the Hormuz Pass</p>
               </div>
               <button 
                 onClick={() => setShowLeaderboard(false)}
                 className="p-3 bg-white/10 rounded-full hover:bg-white/20 transition-colors"
               >
                 <X className="w-6 h-6 text-white" />
               </button>
            </div>

            <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar">
              <div className="flex flex-col gap-3">
                {leaderboard.length === 0 ? (
                  <div className="text-center py-20 text-white/40 font-bold">No scores yet. Be the first!</div>
                ) : (
                  leaderboard.map((entry, idx) => (
                    <div key={idx} className="ios-glass p-4 rounded-2xl flex items-center gap-4 border border-white/5">
                       <div className={`text-xl font-black w-8 text-center ${idx === 0 ? 'text-yellow-400' : idx === 1 ? 'text-slate-300' : idx === 2 ? 'text-amber-600' : 'text-white/30'}`}>
                         #{idx + 1}
                       </div>
                       <div className="flex-1">
                          <div className="text-sm font-bold text-white mb-0.5">{entry.displayName}</div>
                          <div className="text-[10px] text-white/50 uppercase tracking-wider">{entry.cargoType} Cargo • ${entry.cash} revenue</div>
                       </div>
                       <div className="text-right">
                          <div className="text-xl font-black text-white">{entry.score.toLocaleString()} <span className="text-[10px] text-white/40 uppercase">NM</span></div>
                       </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </motion.div>
        )}
        
        {/* Levy and GameOver overlays remain consistent with existing styles */}
        {status === "levy" && (
          <motion.div 
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.9, opacity: 0 }}
            className="absolute inset-0 z-[100] bg-black/80 backdrop-blur-md flex items-center justify-center p-8 text-center"
          >
            <div className="ios-card p-10 max-w-sm w-full shadow-2xl border border-amber-500/30">
              <div className="bg-amber-500 w-16 h-16 rounded-3xl flex items-center justify-center mx-auto mb-6 shadow-lg shadow-amber-500/30">
                <ShieldAlert className="w-8 h-8 text-white" />
              </div>
              <h2 className="text-2xl font-black text-white mb-2">Toll Inspection</h2>
              <p className="text-white/70 text-sm mb-8 font-medium">
                Align vessel trajectory for clearance. <br/>
                <span className="text-amber-500 font-bold text-xs uppercase tracking-widest">Target the Green Zone</span>
              </p>

              {/* Timing Bar */}
              <div className="w-full h-12 bg-black/40 rounded-xl relative mb-10 border border-white/10 overflow-hidden">
                {/* Zones */}
                <div className="absolute inset-y-0 left-[25%] right-[25%] bg-amber-500/20" />
                <div className="absolute inset-y-0 left-[40%] right-[40%] bg-ios-green/40 shadow-[0_0_15px_rgba(52,199,89,0.3)]" />
                
                {/* Indicator */}
                <motion.div 
                  className="absolute top-0 bottom-0 w-1 bg-white shadow-[0_0_10px_white] z-10"
                  style={{ left: `${tollProgress}%` }}
                />
              </div>

              <div className="flex flex-col gap-3">
                <button 
                  onClick={handleTollAction}
                  className="ios-btn w-full py-4 text-lg flex items-center justify-center gap-2 shadow-amber-500/20"
                >
                  Pay & Clear Passage
                </button>
                <div className="flex justify-between text-[10px] text-white/30 font-bold uppercase px-2">
                  <span>Penalty Risk</span>
                  <span>Max Bonus 50% Off</span>
                  <span>Penalty Risk</span>
                </div>
              </div>
            </div>
          </motion.div>
        )}

        {status === "gameOver" && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="absolute inset-0 z-[100] bg-ios-red/10 backdrop-blur-3xl flex items-center justify-center p-8 text-center"
          >
            <div className="ios-card p-10 max-w-sm w-full shadow-2xl border border-ios-red/30">
              <div className="bg-ios-red w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-6 animate-pulse">
                <Skull className="w-10 h-10 text-white" />
              </div>
              <h1 className="text-4xl font-black text-white mb-2 tracking-tighter italic">VESSEL LOST</h1>
              <p className="text-white/50 text-sm mb-10 font-medium leading-tight">
                Your tanker was compromised. The Strait has claimed another victim.
              </p>
              <div className="ios-glass mb-10 py-4 px-6 rounded-2xl flex flex-col gap-4">
                <div>
                  <span className="text-[10px] uppercase font-bold text-ios-red block mb-1">Distance Achieved</span>
                  <span className="text-4xl font-black text-white">{score} <span className="text-sm">NM</span></span>
                </div>
                <div className="h-px w-full bg-white/10" />
                <div className="flex justify-between items-center">
                  <span className="text-[10px] uppercase font-bold text-white/50">Run Profit</span>
                  <span className="text-xl font-black text-green-400">+${cash}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-[10px] uppercase font-bold text-white/50">Total Bank Balance</span>
                  <span className="text-lg font-black text-white">${bankBalance}</span>
                </div>
              </div>
              <div className="flex flex-col gap-3">
                <button 
                  onClick={startGame}
                  className="ios-btn w-full py-4 text-lg bg-white text-ios-red flex items-center justify-center gap-2 shadow-xl"
                >
                  Restart Mission
                </button>
                <button 
                  onClick={() => setShowLeaderboard(true)}
                  className="ios-glass w-full py-3 text-sm text-white font-bold flex items-center justify-center gap-2 border border-white/5 active:scale-95 transition-transform rounded-xl"
                >
                  <Trophy className="w-4 h-4 text-yellow-500" />
                  View Leaderboard
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
