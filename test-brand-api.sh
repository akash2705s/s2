#!/bin/bash

# Siau Server - Brand Feature Test Script
# This script tests the complete brand and overlay element workflow

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m' # No Color

BASE_URL="http://localhost:3000"

echo -e "${BLUE}=== Siau Server - Brand Feature Test ===${NC}\n"

# Step 1: Sign up
echo -e "${GREEN}Step 1: Creating new user...${NC}"
SIGNUP_RESPONSE=$(curl -s -X POST "$BASE_URL/api/auth/user/signup" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "password": "password123",
    "name": "Test User"
  }')

TOKEN=$(echo $SIGNUP_RESPONSE | grep -o '"token":"[^"]*' | sed 's/"token":"//')

if [ -z "$TOKEN" ]; then
  echo -e "${RED}Failed to get token. Response: $SIGNUP_RESPONSE${NC}"
  echo -e "${BLUE}Trying to sign in instead...${NC}"
  
  # Try sign in instead
  SIGNIN_RESPONSE=$(curl -s -X POST "$BASE_URL/api/auth/user/signin" \
    -H "Content-Type: application/json" \
    -d '{
      "email": "test@example.com",
      "password": "password123"
    }')
  
  TOKEN=$(echo $SIGNIN_RESPONSE | grep -o '"token":"[^"]*' | sed 's/"token":"//')
fi

if [ -z "$TOKEN" ]; then
  echo -e "${RED}Failed to authenticate. Exiting.${NC}"
  exit 1
fi

echo -e "${GREEN}✓ Authenticated successfully${NC}\n"

# Step 2: Create first brand (automatically default)
echo -e "${GREEN}Step 2: Creating first brand (will be default)...${NC}"
BRAND1_RESPONSE=$(curl -s -X POST "$BASE_URL/api/brands" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "name": "My First Brand",
    "description": "This is my primary brand",
    "settings": {
      "primaryColor": "#FF5733",
      "theme": "dark"
    }
  }')

BRAND1_ID=$(echo $BRAND1_RESPONSE | grep -o '"_id":"[^"]*' | sed 's/"_id":"//' | head -1)
echo -e "${GREEN}✓ First brand created (ID: $BRAND1_ID)${NC}\n"

# Step 3: Get default brand
echo -e "${GREEN}Step 3: Getting default brand...${NC}"
DEFAULT_BRAND=$(curl -s "$BASE_URL/api/brands/default" \
  -H "Authorization: Bearer $TOKEN")
echo "Response: $DEFAULT_BRAND"
echo ""

# Step 4: Create overlay element for first brand
echo -e "${GREEN}Step 4: Creating overlay element for first brand...${NC}"
ELEMENT1_RESPONSE=$(curl -s -X POST "$BASE_URL/api/overlay" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d "{
    \"brandId\": \"$BRAND1_ID\",
    \"meta\": {
      \"title\": \"Button Element\",
      \"type\": \"button\"
    },
    \"configuration\": {
      \"position\": {\"x\": 100, \"y\": 200},
      \"size\": {\"width\": 150, \"height\": 50},
      \"color\": \"#FF5733\"
    }
  }")

ELEMENT1_ID=$(echo $ELEMENT1_RESPONSE | grep -o '"_id":"[^"]*' | sed 's/"_id":"//' | head -1)
echo -e "${GREEN}✓ Overlay element created (ID: $ELEMENT1_ID)${NC}\n"

# Step 5: Create second brand
echo -e "${GREEN}Step 5: Creating second brand...${NC}"
BRAND2_RESPONSE=$(curl -s -X POST "$BASE_URL/api/brands" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "name": "My Second Brand",
    "description": "This is my secondary brand",
    "settings": {
      "primaryColor": "#33FF57",
      "theme": "light"
    }
  }')

BRAND2_ID=$(echo $BRAND2_RESPONSE | grep -o '"_id":"[^"]*' | sed 's/"_id":"//' | head -1)
echo -e "${GREEN}✓ Second brand created (ID: $BRAND2_ID)${NC}\n"

# Step 6: Get all brands
echo -e "${GREEN}Step 6: Getting all brands...${NC}"
ALL_BRANDS=$(curl -s "$BASE_URL/api/brands" \
  -H "Authorization: Bearer $TOKEN")
echo "Response: $ALL_BRANDS"
echo ""

# Step 7: Create overlay element for second brand
echo -e "${GREEN}Step 7: Creating overlay element for second brand...${NC}"
ELEMENT2_RESPONSE=$(curl -s -X POST "$BASE_URL/api/overlay" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d "{
    \"brandId\": \"$BRAND2_ID\",
    \"meta\": {
      \"title\": \"Image Element\",
      \"type\": \"image\"
    },
    \"configuration\": {
      \"position\": {\"x\": 300, \"y\": 400},
      \"size\": {\"width\": 200, \"height\": 200},
      \"url\": \"https://example.com/image.png\"
    }
  }")

ELEMENT2_ID=$(echo $ELEMENT2_RESPONSE | grep -o '"_id":"[^"]*' | sed 's/"_id":"//' | head -1)
echo -e "${GREEN}✓ Overlay element created (ID: $ELEMENT2_ID)${NC}\n"

# Step 8: Get all overlay elements
echo -e "${GREEN}Step 8: Getting all overlay elements...${NC}"
ALL_ELEMENTS=$(curl -s "$BASE_URL/api/overlay" \
  -H "Authorization: Bearer $TOKEN")
echo "Response: $ALL_ELEMENTS"
echo ""

# Step 9: Get elements by brand
echo -e "${GREEN}Step 9: Getting elements for first brand only...${NC}"
BRAND1_ELEMENTS=$(curl -s "$BASE_URL/api/overlay?brandId=$BRAND1_ID" \
  -H "Authorization: Bearer $TOKEN")
echo "Response: $BRAND1_ELEMENTS"
echo ""

# Step 10: Set second brand as default
echo -e "${GREEN}Step 10: Setting second brand as default...${NC}"
SET_DEFAULT_RESPONSE=$(curl -s -X PUT "$BASE_URL/api/brands/$BRAND2_ID/set-default" \
  -H "Authorization: Bearer $TOKEN")
echo "Response: $SET_DEFAULT_RESPONSE"
echo ""

# Step 11: Verify default brand changed
echo -e "${GREEN}Step 11: Verifying default brand changed...${NC}"
NEW_DEFAULT_BRAND=$(curl -s "$BASE_URL/api/brands/default" \
  -H "Authorization: Bearer $TOKEN")
echo "Response: $NEW_DEFAULT_BRAND"
echo ""

# Step 12: Try to delete default brand (should fail)
echo -e "${GREEN}Step 12: Trying to delete default brand (should fail)...${NC}"
DELETE_DEFAULT=$(curl -s -X DELETE "$BASE_URL/api/brands/$BRAND2_ID" \
  -H "Authorization: Bearer $TOKEN")
echo "Response: $DELETE_DEFAULT"
echo ""

# Step 13: Update a brand
echo -e "${GREEN}Step 13: Updating first brand...${NC}"
UPDATE_BRAND=$(curl -s -X PUT "$BASE_URL/api/brands/$BRAND1_ID" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "name": "My Updated First Brand",
    "description": "Updated description"
  }')
echo "Response: $UPDATE_BRAND"
echo ""

# Step 14: Get specific element
echo -e "${GREEN}Step 14: Getting specific overlay element...${NC}"
SPECIFIC_ELEMENT=$(curl -s "$BASE_URL/api/overlay/$ELEMENT1_ID" \
  -H "Authorization: Bearer $TOKEN")
echo "Response: $SPECIFIC_ELEMENT"
echo ""

# Summary
echo -e "${BLUE}=== Test Summary ===${NC}"
echo -e "Token: ${GREEN}$TOKEN${NC}"
echo -e "Brand 1 ID: ${GREEN}$BRAND1_ID${NC}"
echo -e "Brand 2 ID: ${GREEN}$BRAND2_ID${NC}"
echo -e "Element 1 ID: ${GREEN}$ELEMENT1_ID${NC}"
echo -e "Element 2 ID: ${GREEN}$ELEMENT2_ID${NC}"
echo ""
echo -e "${GREEN}✓ All tests completed!${NC}"
echo ""
echo -e "${BLUE}Next steps:${NC}"
echo "1. Check your MongoDB database to verify data"
echo "2. Try the API endpoints manually using curl or Postman"
echo "3. Review the documentation in BRAND_API.md"
