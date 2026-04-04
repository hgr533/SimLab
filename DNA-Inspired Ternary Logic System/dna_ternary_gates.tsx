import React, { useState } from 'react';
import { AlertCircle, Zap, Binary } from 'lucide-react';

const DNATernaryGates = () => {
  const [strand1, setStrand1] = useState('ATCG');
  const [strand2, setStrand2] = useState('TAGC');
  const [gateType, setGateType] = useState('complement');

  // Biological constants
  const HYDROGEN_BONDS = {
    'AT': 2, 'TA': 2,
    'CG': 3, 'GC': 3
  };

  const complement = {'A': 'T', 'T': 'A', 'C': 'G', 'G': 'C'};

  // Ternary logic gates based on DNA interactions
  const gates = {
    complement: (b1, b2) => {
      // +1: Perfect complementary pairing (biological match)
      // 0: No interaction (neutral)
      // -1: Same base (repulsion in real DNA)
      if (complement[b1] === b2) return 1;
      if (b1 === b2) return -1;
      return 0;
    },
    
    energy: (b1, b2) => {
      // Normalized hydrogen bond energy as ternary
      const key = b1 + b2;
      const bonds = HYDROGEN_BONDS[key] || 0;
      if (bonds === 3) return 1;      // Strong (C-G)
      if (bonds === 2) return 0;      // Medium (A-T)
      return -1;                       // No binding
    },
    
    consensus: (b1, b2) => {
      // Ternary consensus logic (useful for error correction)
      // +1: Both agree and are purines (A, G)
      // -1: Both agree and are pyrimidines (C, T)
      // 0: Disagree
      const purines = ['A', 'G'];
      const pyrimidines = ['C', 'T'];
      
      if (b1 === b2) {
        if (purines.includes(b1)) return 1;
        if (pyrimidines.includes(b1)) return -1;
      }
      return 0;
    },
    
    mutation: (b1, b2) => {
      // Simulates mutation likelihood
      // +1: Transition (purine↔purine or pyrimidine↔pyrimidine)
      // -1: Transversion (purine↔pyrimidine)
      // 0: No change
      const purines = ['A', 'G'];
      const pyrimidines = ['C', 'T'];
      
      if (b1 === b2) return 0;
      
      const b1_purine = purines.includes(b1);
      const b2_purine = purines.includes(b2);
      
      if (b1_purine === b2_purine) return 1;  // Same class
      return -1;  // Different class
    }
  };

  const computeGate = () => {
    if (strand1.length !== strand2.length) {
      return { result: [], error: 'Strands must be same length' };
    }

    const result = [];
    for (let i = 0; i < strand1.length; i++) {
      const b1 = strand1[i];
      const b2 = strand2[i];
      if (!'ATCG'.includes(b1) || !'ATCG'.includes(b2)) {
        return { result: [], error: 'Invalid DNA base (use A, T, C, G only)' };
      }
      result.push(gates[gateType](b1, b2));
    }
    return { result, error: null };
  };

  const { result, error } = computeGate();

  const getColor = (val) => {
    if (val === 1) return 'bg-green-500';
    if (val === -1) return 'bg-red-500';
    return 'bg-gray-400';
  };

  const getTernarySum = () => {
    if (result.length === 0) return 'N/A';
    const sum = result.reduce((a, b) => a + b, 0);
    return `${sum} (avg: ${(sum / result.length).toFixed(2)})`;
  };

  const toBinary = (ternary) => {
    // Convert ternary {-1,0,1} to balanced ternary number
    let decimal = 0;
    for (let i = 0; i < ternary.length; i++) {
      decimal += ternary[i] * Math.pow(3, ternary.length - 1 - i);
    }
    return decimal;
  };

  return (
    <div className="max-w-4xl mx-auto p-6 bg-gradient-to-br from-blue-50 to-purple-50 rounded-lg">
      <div className="bg-white rounded-lg shadow-lg p-6 mb-6">
        <h1 className="text-3xl font-bold mb-2 text-blue-900">DNA Ternary Logic Gates</h1>
        <p className="text-gray-600 mb-4">Exploring computational models inspired by molecular biology</p>
        
        <div className="bg-blue-100 border-l-4 border-blue-500 p-4 mb-6">
          <div className="flex items-start">
            <AlertCircle className="w-5 h-5 text-blue-700 mr-2 mt-0.5" />
            <div className="text-sm text-blue-800">
              <strong>Ternary Logic:</strong> Unlike binary (0,1), ternary uses three states: -1, 0, +1.
              This naturally models DNA interactions: binding (+1), neutral (0), repulsion (-1).
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4 mb-6">
          <div>
            <label className="block text-sm font-medium mb-2">DNA Strand 1</label>
            <input
              type="text"
              value={strand1}
              onChange={(e) => setStrand1(e.target.value.toUpperCase())}
              className="w-full p-3 border-2 border-blue-300 rounded font-mono text-lg"
              placeholder="ATCG"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-2">DNA Strand 2</label>
            <input
              type="text"
              value={strand2}
              onChange={(e) => setStrand2(e.target.value.toUpperCase())}
              className="w-full p-3 border-2 border-purple-300 rounded font-mono text-lg"
              placeholder="TAGC"
            />
          </div>
        </div>

        <div className="mb-6">
          <label className="block text-sm font-medium mb-2">Gate Type</label>
          <select
            value={gateType}
            onChange={(e) => setGateType(e.target.value)}
            className="w-full p-3 border-2 border-gray-300 rounded"
          >
            <option value="complement">Complementarity Gate (A-T, C-G pairing)</option>
            <option value="energy">Energy Gate (H-bond strength)</option>
            <option value="consensus">Consensus Gate (purine/pyrimidine agreement)</option>
            <option value="mutation">Mutation Gate (transition likelihood)</option>
          </select>
        </div>

        {error && (
          <div className="bg-red-100 border-l-4 border-red-500 p-4 mb-6">
            <p className="text-red-700">{error}</p>
          </div>
        )}

        {!error && result.length > 0 && (
          <div className="space-y-6">
            <div className="bg-gray-50 p-6 rounded-lg">
              <h3 className="font-bold mb-4 flex items-center">
                <Zap className="w-5 h-5 mr-2 text-yellow-600" />
                Gate Output (Ternary)
              </h3>
              
              <div className="grid grid-cols-1 gap-4">
                <div className="font-mono text-center">
                  <div className="text-2xl text-blue-600 mb-2">{strand1}</div>
                  <div className="text-2xl text-purple-600 mb-2">{strand2}</div>
                  <div className="flex justify-center gap-1 mb-2">
                    {result.map((val, i) => (
                      <div
                        key={i}
                        className={`w-12 h-12 ${getColor(val)} text-white flex items-center justify-center rounded font-bold text-xl`}
                      >
                        {val === 1 ? '+1' : val === 0 ? '0' : '-1'}
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="mt-4 pt-4 border-t border-gray-300 grid grid-cols-3 gap-4 text-sm">
                <div>
                  <span className="font-semibold">Sum:</span> {getTernarySum()}
                </div>
                <div>
                  <span className="font-semibold">Decimal value:</span> {toBinary(result)}
                </div>
                <div>
                  <span className="font-semibold">Pattern:</span> [{result.join(', ')}]
                </div>
              </div>
            </div>

            <div className="bg-purple-50 p-6 rounded-lg">
              <h3 className="font-bold mb-3 flex items-center">
                <Binary className="w-5 h-5 mr-2 text-purple-600" />
                Biological Interpretation
              </h3>
              <div className="space-y-2 text-sm">
                {gateType === 'complement' && (
                  <p>This gate models Watson-Crick base pairing. +1 indicates stable hybridization (DNA double helix formation), -1 suggests instability.</p>
                )}
                {gateType === 'energy' && (
                  <p>C-G pairs (3 H-bonds) are stronger than A-T pairs (2 H-bonds). This affects DNA melting temperature and stability.</p>
                )}
                {gateType === 'consensus' && (
                  <p>Purines (A,G) and pyrimidines (C,T) have different chemical structures. This gate detects structural agreement.</p>
                )}
                {gateType === 'mutation' && (
                  <p>Transitions (A↔G, C↔T) are more common than transversions in evolution. +1 indicates likely mutations.</p>
                )}
              </div>
            </div>

            <div className="bg-green-50 p-6 rounded-lg">
              <h3 className="font-bold mb-3">Applications</h3>
              <ul className="space-y-2 text-sm">
                <li>• <strong>Error correction:</strong> Consensus gates can vote on correct sequences</li>
                <li>• <strong>Primer design:</strong> Energy gates optimize PCR primer binding</li>
                <li>• <strong>Drug targeting:</strong> Complementarity gates design antisense therapies</li>
                <li>• <strong>Evolutionary modeling:</strong> Mutation gates predict sequence drift</li>
              </ul>
            </div>
          </div>
        )}
      </div>

      <div className="bg-white rounded-lg shadow-lg p-6">
        <h2 className="text-xl font-bold mb-4">Why Ternary for DNA?</h2>
        <div className="space-y-4 text-sm">
          <p>
            <strong>Beyond Binary:</strong> DNA naturally has 4 states (A,T,C,G), but interactions have 3 outcomes:
            attraction, neutral, or repulsion. Ternary captures this better than binary.
          </p>
          <p>
            <strong>Balanced Ternary:</strong> Using {-1, 0, +1} allows symmetric positive/negative logic,
            useful for modeling opposing forces in molecular systems.
          </p>
          <p>
            <strong>Information Density:</strong> Ternary can represent log₂(3) ≈ 1.58 bits per trit,
            between binary (1 bit) and quaternary (2 bits), matching DNA's intermediate complexity.
          </p>
        </div>
      </div>
    </div>
  );
};

export default DNATernaryGates;