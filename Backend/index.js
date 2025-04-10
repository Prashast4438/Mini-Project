require("dotenv").config();
const express = require("express");
const multer = require("multer");
const sharp = require("sharp");
const crypto = require("crypto");
const { ethers } = require("ethers");
const fs = require("fs");
const cors = require("cors");

const app = express();
app.use(express.json());
app.use(cors());

// Load contract ABI
const contractABI = JSON.parse(fs.readFileSync("./contractABI.json", "utf8"));
const provider = new ethers.JsonRpcProvider(process.env.INFURA_RPC_URL);
const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
const contract = new ethers.Contract(process.env.CONTRACT_ADDRESS, contractABI, wallet);

const upload = multer({ dest: "uploads/" });

const generatePhash = async (filePath) => {
    const imageBuffer = await sharp(filePath).resize(256, 256).greyscale().toBuffer();
    fs.unlinkSync(filePath);
    return crypto.createHash("sha256").update(imageBuffer).digest("hex");
};

const hammingDistance = (hash1, hash2) => {
    return [...hash1].reduce((dist, char, i) => dist + (char !== hash2[i]), 0);
};

app.post("/register", upload.single("image"), async (req, res) => {
    try {
        const { name, address } = req.body;
        if (!req.file || !name) return res.status(400).json({ error: "Missing image or name" });

        const contractOwner = await contract.owner();
        if (address.toLowerCase() !== contractOwner.toLowerCase()) {
            return res.status(403).json({ error: "Only owner can register NFTs" });
        }

        const pHash = await generatePhash(req.file.path);

        try {
            const existing = await contract.getNFTPhash(name);
            if (existing) return res.status(400).json({ error: "NFT already registered" });
        } catch (_) {
            console.log("NFT not found. Proceeding to register.");
        }

        const tx = await contract.registerNFT(name, pHash);
        await tx.wait();
        res.json({ message: "NFT registered successfully!", txHash: tx.hash });
    } catch (error) {
        console.error("Register Error:", error);
        res.status(500).json({ error: error.reason || "Registration failed" });
    }
});

app.post("/verify", upload.single("image"), async (req, res) => {
    try {
        const { name } = req.body;
        if (!req.file || !name) return res.status(400).json({ error: "Missing image or name" });

        const uploadedPhash = await generatePhash(req.file.path);
        const storedPhash = await contract.getNFTPhash(name);
        const isExact = await contract.verifyNFT(name, uploadedPhash);

        if (isExact) {
            return res.json({ message: "NFT is authentic ✅ (Exact Match)" });
        }

        const distance = hammingDistance(uploadedPhash, storedPhash);
        const threshold = 5;
        if (distance <= threshold) {
            return res.json({ message: "NFT is authentic ✅ (Near Match)", distance });
        } else {
            return res.json({ message: "NFT is FAKE ❌", distance });
        }
    } catch (error) {
        console.error("Verify Error:", error);
        res.status(500).json({ error: "Verification failed" });
    }
});