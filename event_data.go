package main

import "encoding/json"

// FacetsResponse represents the structure captured from Ticketmaster
type FacetsResponse struct {
	Facets []Facet `json:"facets"`
}

// Facet represents a single facet group (e.g., Inventory Types, Sections, Prices)
type Facet struct {
	Name   string  `json:"name"`   // e.g. "inventoryType", "section", "totalPrice"
	Values []Value `json:"values"` // The counts and values
}

// Value represents the specific data point within a facet
type Value struct {
	Count int    `json:"count"`
	Name  string `json:"name"`  // e.g. "resale", "Section 101", "150.0"
	Id    string `json:"id,omitempty"`
}

// ParsedData is a helper for cleaner Go processing if we want to map it
type ParsedData struct {
	ResaleCount int
	MinPrice    float64
	Sections    []string
}
