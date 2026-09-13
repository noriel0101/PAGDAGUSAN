const express = require("express");
const pool = require("../db");

const router = express.Router();

const availableRoomWhere = `
  r.status = 'available'
  AND r.current_occupancy < r.capacity
  AND NOT EXISTS (
    SELECT 1 FROM leases l
    WHERE l.room_id = r.id AND l.status IN ('active', 'pending_approval')
  )
`;

function mapRoom(row) {
  return {
    id: row.id,
    roomNumber: row.room_number,
    floor: row.floor,
    roomType: row.room_type || null,
    description: row.description,
    price: Number(row.monthly_rent),
    monthlyRent: Number(row.monthly_rent),
    capacity: row.capacity,
    currentOccupancy: row.current_occupancy,
    availability: row.status === "available" && row.current_occupancy < row.capacity,
    status: row.status,
    amenities: row.amenities || [],
  };
}

router.get("/properties", async (req, res) => {
  try {
    const { search } = req.query;
    const params = [];
    let query = `
      SELECT p.id, p.name, p.address, p.description, p.contact_number,
             u.name AS owner_name, u.phone AS owner_phone,
             COUNT(r.id) FILTER (WHERE ${availableRoomWhere})::int AS available_rooms
      FROM properties p
      JOIN users u ON u.id = p.owner_id AND u.role = 'owner' AND u.status = 'active'
      LEFT JOIN rooms r ON r.property_id = p.id
      WHERE p.status = 'active'
    `;

    if (search) {
      params.push(`%${search}%`);
      query += ` AND (LOWER(p.name) LIKE LOWER($1) OR LOWER(p.address) LIKE LOWER($1))`;
    }

    query += ` GROUP BY p.id, u.name, u.phone ORDER BY p.name`;
    const result = await pool.query(query, params);

    return res.json({
      success: true,
      data: result.rows.map((row) => ({
        id: row.id,
        name: row.name,
        address: row.address,
        description: row.description,
        contactNumber: row.contact_number,
        ownerName: row.owner_name,
        ownerPhone: row.owner_phone,
        availableRooms: row.available_rooms,
      })),
    });
  } catch (error) {
    console.error("Browse properties error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

router.get("/properties/:id", async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT p.id, p.name, p.address, p.description, p.contact_number,
              u.name AS owner_name, u.phone AS owner_phone
       FROM properties p
       JOIN users u ON u.id = p.owner_id AND u.role = 'owner' AND u.status = 'active'
       WHERE p.id = $1 AND p.status = 'active'`,
      [req.params.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Property not found" });
    }

    const property = result.rows[0];
    const rooms = await pool.query(
      `SELECT r.id, r.room_number, r.floor, r.room_type, r.description, r.monthly_rent,
              r.capacity, r.current_occupancy, r.status, r.amenities
       FROM rooms r
       WHERE r.property_id = $1 AND ${availableRoomWhere}
       ORDER BY r.room_number`,
      [req.params.id]
    );

    return res.json({
      success: true,
      data: {
        id: property.id,
        name: property.name,
        address: property.address,
        description: property.description,
        contactNumber: property.contact_number,
        ownerName: property.owner_name,
        ownerPhone: property.owner_phone,
        rooms: rooms.rows.map(mapRoom),
      },
    });
  } catch (error) {
    console.error("Browse property error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

router.get("/properties/:id/rooms", async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT r.id, r.room_number, r.floor, r.room_type, r.description, r.monthly_rent,
              r.capacity, r.current_occupancy, r.status, r.amenities
       FROM rooms r
       JOIN properties p ON p.id = r.property_id AND p.status = 'active'
       JOIN users u ON u.id = p.owner_id AND u.role = 'owner' AND u.status = 'active'
       WHERE r.property_id = $1 AND ${availableRoomWhere}
       ORDER BY r.room_number`,
      [req.params.id]
    );
    return res.json({ success: true, data: result.rows.map(mapRoom) });
  } catch (error) {
    console.error("Browse property rooms error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

router.get("/rooms/:id", async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT r.id, r.room_number, r.floor, r.room_type, r.description, r.monthly_rent,
              r.capacity, r.current_occupancy, r.status, r.amenities,
              p.id AS property_id, p.name AS property_name, p.address,
              p.contact_number, u.name AS owner_name, u.phone AS owner_phone
       FROM rooms r
       JOIN properties p ON p.id = r.property_id AND p.status = 'active'
       JOIN users u ON u.id = p.owner_id AND u.role = 'owner' AND u.status = 'active'
       WHERE r.id = $1 AND ${availableRoomWhere}`,
      [req.params.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Available room not found" });
    }

    const room = result.rows[0];
    return res.json({
      success: true,
      data: {
        ...mapRoom(room),
        propertyId: room.property_id,
        propertyName: room.property_name,
        propertyAddress: room.address,
        propertyContact: room.contact_number,
        ownerName: room.owner_name,
        ownerPhone: room.owner_phone,
      },
    });
  } catch (error) {
    console.error("Browse room error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

module.exports = router;
