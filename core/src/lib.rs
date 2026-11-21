//! Thirstr client core. Beta slice: location cells (F-05).
//!
//! The device turns a position into H3 cells; only cells leave the phone for
//! City/Area levels. MLS, storage and media crypto land here in later slices.

use h3o::{CellIndex, LatLng, Resolution};

/// Cells sent for the Area level (R-05: ~200 m, res 9) plus parents used for
/// k-anonymity fallback and map aggregation.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Cells {
    pub r9: String,
    pub r8: String,
    pub r7: String,
    pub r5: String,
}

#[derive(Debug, PartialEq, Eq)]
pub enum CellError {
    InvalidCoordinate,
}

/// Computes the cell set for a coordinate. Coordinates are never returned or stored.
pub fn cells_for(lat: f64, lng: f64) -> Result<Cells, CellError> {
    if !(-90.0..=90.0).contains(&lat) || !(-180.0..=180.0).contains(&lng) {
        return Err(CellError::InvalidCoordinate);
    }
    let ll = LatLng::new(lat, lng).map_err(|_| CellError::InvalidCoordinate)?;
    let r9 = ll.to_cell(Resolution::Nine);
    let parent = |r: Resolution| -> String {
        r9.parent(r)
            .map(|c: CellIndex| c.to_string())
            .unwrap_or_default()
    };
    Ok(Cells {
        r9: r9.to_string(),
        r8: parent(Resolution::Eight),
        r7: parent(Resolution::Seven),
        r5: parent(Resolution::Five),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn zurich_cells_are_consistent_with_server_h3() {
        // Same value Postgres h3-pg returns for h3_lat_lng_to_cell(point(8.5417, 47.3769), 9).
        let c = cells_for(47.3769, 8.5417).unwrap();
        assert_eq!(c.r9, "891f8ed951bffff");
        assert!(c.r5.starts_with("85"));
    }

    #[test]
    fn rejects_out_of_range() {
        assert_eq!(cells_for(91.0, 0.0), Err(CellError::InvalidCoordinate));
    }
}
