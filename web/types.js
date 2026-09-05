"use strict";

/**
 * @fileoverview types.js — Zentrale JSDoc-Typdefinitionen für Impala67.
 * Dient der statischen Code-Analyse, IDE-Autovervollständigung und Refactoring-Sicherheit.
 * 100% native ES-Module ohne Bundler oder Kompilierungsschritt.
 */

/**
 * @typedef {Object} NotePage
 * @property {string} id
 * @property {string} title
 * @property {string|null} parentId
 * @property {string} content
 * @property {string|null} [pdfId]
 * @property {string[]} [tags]
 * @property {string} [icon]
 * @property {string} [cover]
 * @property {string} [notionId]
 * @property {string} created
 * @property {string} updated
 * @property {boolean} [deleted]
 */

/**
 * @typedef {Object} CardSRS
 * @property {number} due
 * @property {number} interval
 * @property {number} ease
 * @property {number} reps
 * @property {number} lapses
 * @property {number} state
 */

/**
 * @typedef {Object} Card
 * @property {string} id
 * @property {string} front
 * @property {string} back
 * @property {string} pageId
 * @property {CardSRS} srs
 * @property {string} created
 * @property {string} [updated]
 * @property {boolean} [deleted]
 */

/**
 * @typedef {Object} Grade
 * @property {string} id
 * @property {string} subject
 * @property {number} grade
 * @property {number} weight
 * @property {string} date
 * @property {string} [comment]
 * @property {string} created
 * @property {boolean} [deleted]
 */

/**
 * @typedef {Object} LearningSession
 * @property {string} id
 * @property {string} startedAt
 * @property {string} endedAt
 * @property {number} durationSeconds
 * @property {string} category
 * @property {string} subject
 * @property {string} [subjectSource]
 * @property {string} [sourceId]
 * @property {string} updated
 * @property {boolean} [deleted]
 */

/**
 * @typedef {Object} ChatMessage
 * @property {"user"|"assistant"|"system"} role
 * @property {string} content
 * @property {string} [created]
 * @property {Object} [meta]
 */

/**
 * @typedef {Object} ChatSession
 * @property {string} id
 * @property {string} title
 * @property {ChatMessage[]} messages
 * @property {string} created
 * @property {string} updated
 * @property {boolean} [deleted]
 */

/**
 * @typedef {number[]} Point - [x, y, pressure, timestamp]
 */

/**
 * @typedef {Object} HeftStroke
 * @property {string} id
 * @property {"pen"|"highlighter"|"eraser"} tool
 * @property {string} color
 * @property {number} size
 * @property {Point[]} pts
 * @property {Object} [shape]
 */

/**
 * @typedef {Object} HeftTextBox
 * @property {string} id
 * @property {number} x
 * @property {number} y
 * @property {number} [w]
 * @property {number} [h]
 * @property {string} text
 * @property {string} [color]
 * @property {number} [size]
 */

/**
 * @typedef {Object} HeftImage
 * @property {string} id
 * @property {number} x
 * @property {number} y
 * @property {number} w
 * @property {number} h
 * @property {string} blobId
 */

/**
 * @typedef {Object} HeftPage
 * @property {string} id
 * @property {HeftStroke[]} strokes
 * @property {HeftTextBox[]} [texts]
 * @property {HeftImage[]} [images]
 * @property {"lined"|"grid"|"dots"|"blank"} [bg]
 * @property {number} [width]
 * @property {number} [height]
 */

/**
 * @typedef {Object} HeftDoc
 * @property {string} id
 * @property {HeftPage[]} pages
 */

/**
 * @typedef {Object} SyncEvent
 * @property {string} id
 * @property {string} type
 * @property {string} ts
 * @property {string} [client]
 * @property {Object} data
 */

export const TYPES = {};
