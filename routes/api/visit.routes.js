/**
 * Visit Routes
 *
 * This module handles all visit-related API endpoints including:
 * - Visit management (CRUD operations)
 * - Wire tracking (upper/lower wire management)
 * - Visit summaries and details
 * - Work-specific visit operations
 */

import express from 'express';
import {
    getWires,
    getVisitsSummary,
    addVisit,
    updateVisit,
    deleteVisit,
    getVisitDetailsByID,
    getLatestWire,
    getVisitsByWorkId,
    getVisitById,
    addVisitByWorkId,
    updateVisitByWorkId,
    deleteVisitByWorkId,
    getLatestWiresByWorkId
} from '../../services/database/queries/visit-queries.js';

const router = express.Router();

// ============================================================================
// Visit Summary Routes
// ============================================================================

/**
 * GET /visitsSummary
 * Get summary of all visits for a specific patient
 * Query params: PID (Patient ID)
 */
router.get("/visitsSummary", async (req, res) => {
    try {
        const { PID } = req.query;
        if (!PID) {
            return res.status(400).json({ error: "Missing required parameter: PID" });
        }

        const visitsSummary = await getVisitsSummary(PID);
        res.json(visitsSummary);
    } catch (error) {
        console.error("Error fetching visits summary:", error);
        res.status(500).json({ error: "Failed to fetch visits summary" });
    }
});

/**
 * GET /getVisitDetailsByID
 * Get detailed information for a specific visit
 * Query params: VID (Visit ID)
 */
router.get("/getVisitDetailsByID", async (req, res) => {
    try {
        const { VID } = req.query;
        if (!VID) {
            return res.status(400).json({ error: "Missing required parameter: VID" });
        }

        const visitDetails = await getVisitDetailsByID(VID);
        res.json(visitDetails);
    } catch (error) {
        console.error("Error fetching visit details:", error);
        res.status(500).json({ error: "Failed to fetch visit details" });
    }
});

// ============================================================================
// Wire Management Routes
// ============================================================================

/**
 * GET /getWires
 * Get all available wire types
 */
router.get("/getWires", async (req, res) => {
    try {
        const wires = await getWires();
        res.json(wires);
    } catch (error) {
        console.error("Error fetching wires:", error);
        res.status(500).json({ error: "Failed to fetch wires" });
    }
});

/**
 * GET /getlatestwires
 * Get latest wires (upper and lower) for a specific work ID
 * Query params: workId
 */
router.get("/getlatestwires", async (req, res) => {
    try {
        const { workId } = req.query;
        if (!workId) {
            return res.status(400).json({ error: "Missing required parameter: workId" });
        }
        const latestWires = await getLatestWiresByWorkId(parseInt(workId));
        res.json(latestWires);
    } catch (error) {
        console.error("Error fetching latest wires:", error);
        res.status(500).json({ error: "Failed to fetch latest wires" });
    }
});

/**
 * GET /getLatestwire
 * Get latest wire for a specific patient
 * Query params: PID (Patient ID)
 */
router.get("/getLatestwire", async (req, res) => {
    try {
        const { PID } = req.query;
        if (!PID) {
            return res.status(400).json({ error: "Missing required parameter: PID" });
        }

        const latestWire = await getLatestWire(PID);
        res.json(latestWire);
    } catch (error) {
        console.error("Error fetching latest wire:", error);
        res.status(500).json({ error: "Failed to fetch latest wire" });
    }
});

// ============================================================================
// Work-Based Visit Routes
// ============================================================================

/**
 * GET /getvisitsbywork
 * Get all visits for a specific work ID
 * Query params: workId
 */
router.get("/getvisitsbywork", async (req, res) => {
    try {
        const { workId } = req.query;
        if (!workId) {
            return res.status(400).json({ error: "Missing required parameter: workId" });
        }
        const visits = await getVisitsByWorkId(parseInt(workId));
        res.json(visits);
    } catch (error) {
        console.error("Error fetching visits by work:", error);
        res.status(500).json({ error: "Failed to fetch visits" });
    }
});

/**
 * GET /getvisitbyid
 * Get a single visit by ID
 * Query params: visitId
 */
router.get("/getvisitbyid", async (req, res) => {
    try {
        const { visitId } = req.query;
        if (!visitId) {
            return res.status(400).json({ error: "Missing required parameter: visitId" });
        }
        const visit = await getVisitById(parseInt(visitId));
        if (!visit) {
            return res.status(404).json({ error: "Visit not found" });
        }
        res.json(visit);
    } catch (error) {
        console.error("Error fetching visit by ID:", error);
        res.status(500).json({ error: "Failed to fetch visit" });
    }
});

/**
 * POST /addvisitbywork
 * Add a new visit for a specific work
 * Body: visitData (must include WorkID and VisitDate)
 */
router.post("/addvisitbywork", async (req, res) => {
    try {
        const visitData = req.body;
        if (!visitData.WorkID || !visitData.VisitDate) {
            return res.status(400).json({ error: "Missing required fields: WorkID and VisitDate" });
        }
        const result = await addVisitByWorkId(visitData);
        res.json({ success: true, visitId: result.ID });
    } catch (error) {
        console.error("Error adding visit:", error);
        res.status(500).json({ error: "Failed to add visit" });
    }
});

/**
 * PUT /updatevisitbywork
 * Update a visit
 * Body: visitId, visitData (must include VisitDate)
 */
router.put("/updatevisitbywork", async (req, res) => {
    try {
        const { visitId, ...visitData } = req.body;
        if (!visitId || !visitData.VisitDate) {
            return res.status(400).json({ error: "Missing required fields: visitId and VisitDate" });
        }
        await updateVisitByWorkId(parseInt(visitId), visitData);
        res.json({ success: true });
    } catch (error) {
        console.error("Error updating visit:", error);
        res.status(500).json({ error: "Failed to update visit" });
    }
});

/**
 * DELETE /deletevisitbywork
 * Delete a visit
 * Body: visitId
 */
router.delete("/deletevisitbywork", async (req, res) => {
    try {
        const { visitId } = req.body;
        if (!visitId) {
            return res.status(400).json({ error: "Missing required field: visitId" });
        }
        await deleteVisitByWorkId(parseInt(visitId));
        res.json({ success: true });
    } catch (error) {
        console.error("Error deleting visit:", error);
        res.status(500).json({ error: "Failed to delete visit" });
    }
});

// ============================================================================
// Legacy Visit API Routes
// ============================================================================

/**
 * POST /addVisit
 * Add a new visit (legacy API)
 * Body: PID, visitDate, upperWireID, lowerWireID, others, next
 */
router.post("/addVisit", async (req, res) => {
    try {
        const { PID, visitDate, upperWireID, lowerWireID, others, next } = req.body;
        if (!PID || !visitDate) {
            return res.status(400).json({ status: 'error', message: 'Missing required parameters' });
        }

        const result = await addVisit(PID, visitDate, upperWireID, lowerWireID, others, next);
        res.json({ status: 'success', data: result });
    } catch (error) {
        console.error("Error adding visit:", error);
        res.status(500).json({ status: 'error', message: error.message });
    }
});

/**
 * PUT /updateVisit
 * Update a visit (legacy API)
 * Body: VID, visitDate, upperWireID, lowerWireID, others, next
 */
router.put("/updateVisit", async (req, res) => {
    try {
        const { VID, visitDate, upperWireID, lowerWireID, others, next } = req.body;
        if (!VID || !visitDate) {
            return res.status(400).json({ status: 'error', message: 'Missing required parameters' });
        }

        const result = await updateVisit(VID, visitDate, upperWireID, lowerWireID, others, next);
        res.json({ status: 'success', data: result });
    } catch (error) {
        console.error("Error updating visit:", error);
        res.status(500).json({ status: 'error', message: error.message });
    }
});

/**
 * DELETE /deleteVisit
 * Delete a visit (legacy API)
 * Body: VID (Visit ID)
 */
router.delete("/deleteVisit", async (req, res) => {
    try {
        const { VID } = req.body;
        if (!VID) {
            return res.status(400).json({ status: 'error', message: 'Missing required parameter: VID' });
        }

        const result = await deleteVisit(VID);
        res.json({ status: 'success', data: result });
    } catch (error) {
        console.error("Error deleting visit:", error);
        res.status(500).json({ status: 'error', message: error.message });
    }
});

export default router;
