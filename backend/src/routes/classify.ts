/**
 * © Dominik Tröster, Verbandsgemeinde Otterbach Otterberg
 * Apache License 2.0
 * 
 * Public AI Classification API
 * No authentication required - for citizen form preview
 */

import express, { Request, Response } from 'express';
import { classifySubmission } from '../services/classification.js';

const router = express.Router();

/**
 * POST /api/classify
 * Öffentlicher Endpoint für AI-Kategorisierung mit Wissensdatenbank-Kontext
 * Wird vom Frontend beim Preview-Step aufgerufen (keine Auth erforderlich)
 * 
 * NO personal data (name, email, image) sent to AI - only anonymized description
 * 
 * Body:
 * {
 *   description: "Große Schlaglöcher in der Hauptstraße"
 * }
 * 
 * Response:
 * {
 *   kategorie: "Schlaglöcher & Straßenschäden",
 *   dringlichkeit: "high",
 *   reasoning: "Detaillierte Begründung...",
 *   abteilung: "Abteilung Straßenunterhalt",
 *   categoryId: "schlagloecher"
 * }
 */
router.post('/', async (req: Request, res: Response) => {
  try {
    const { description, location, latitude, longitude, address, city, postalCode, nominatimRaw, weatherReport } = req.body;

    if (!description || typeof description !== 'string' || description.trim().length === 0) {
      return res.status(400).json({
        message: 'description ist erforderlich',
      });
    }

    const { result } = await classifySubmission({
      description,
      location,
      latitude,
      longitude,
      address,
      city,
      postalCode,
      nominatimRaw:
        nominatimRaw && typeof nominatimRaw === 'object' && !Array.isArray(nominatimRaw)
          ? nominatimRaw
          : undefined,
      weatherReport:
        weatherReport && typeof weatherReport === 'object' && !Array.isArray(weatherReport)
          ? weatherReport
          : undefined,
    });

    return res.json(result);
  } catch (error) {
    console.error('Classification endpoint error:', error);
    return res.status(500).json({
      message: 'Fehler bei der Kategorisierung',
      details: error instanceof Error ? error.message : String(error),
    });
  }
});

export default router;
