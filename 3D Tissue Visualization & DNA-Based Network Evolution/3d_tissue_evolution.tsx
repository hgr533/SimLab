import React, { useState, useEffect, useRef } from 'react';
import { Play, Pause, RotateCcw, Dna, Zap, Activity, TrendingUp } from 'lucide-react';

const TissueVisualization3D = () => {
  const canvasRef = useRef(null);
  const [isRunning, setIsRunning] = useState(false);
  const [generation, setGeneration] = useState(0);
  const [viewAngle, setViewAngle] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1.0);
  const [showEntanglement, setShowEntanglement] = useState(true);
  const [showEnergy, setShowEnergy] = useState(true);
  
  // Network state
  const [network, setNetwork] = useState(null);
  const [evolutionHistory, setEvolutionHistory] = useState([]);
  const [bestFitness, setBestFitness] = useState(0);
  
  // DNA-based evolution parameters
  const [populationSize] = useState(20);
  const [selectionPressure, setSelectionPressure] = useState(0.7);
  
  // Initialize network structure
  useEffect(() => {
    initializeNetwork();
  }, []);
  
  const initializeNetwork = () => {
    const layers = [
      { neurons: 8, position: 0 },
      { neurons: 6, position: 1 },
      { neurons: 4, position: 2 }
    ];
    
    const neurons = [];
    const connections = [];
    let neuronId = 0;
    
    // Create neurons with 3D positions
    layers.forEach((layer, layerIdx) => {
      const angleStep = (2 * Math.PI) / layer.neurons;
      const radius = 2.0;
      const z = layerIdx * 3;
      
      for (let i = 0; i < layer.neurons; i++) {
        const angle = i * angleStep;
        neurons.push({
          id: neuronId++,
          layer: layerIdx,
          x: Math.cos(angle) * radius,
          y: Math.sin(angle) * radius,
          z: z,
          state: Math.random() < 0.33 ? -1 : (Math.random() < 0.5 ? 0 : 1),
          energy: Math.random() * 100,
          isPluripotent: Math.random() < 0.3,
          dnaSequence: generateDNASequence(8),
          fitness: 0
        });
      }
    });
    
    // Create connections between layers
    for (let l = 0; l < layers.length - 1; l++) {
      const currentLayer = neurons.filter(n => n.layer === l);
      const nextLayer = neurons.filter(n => n.layer === l + 1);
      
      currentLayer.forEach(n1 => {
        nextLayer.forEach(n2 => {
          // Connection probability based on DNA similarity
          const similarity = calculateDNASimilarity(n1.dnaSequence, n2.dnaSequence);
          if (Math.random() < similarity) {
            connections.push({
              from: n1.id,
              to: n2.id,
              weight: (Math.random() * 2 - 1),
              entangled: Math.random() < 0.3,
              strength: Math.random()
            });
          }
        });
      });
    }
    
    // Add some within-layer connections (gap junctions)
    layers.forEach((layer, layerIdx) => {
      const layerNeurons = neurons.filter(n => n.layer === layerIdx);
      layerNeurons.forEach((n1, i) => {
        const n2 = layerNeurons[(i + 1) % layerNeurons.length];
        connections.push({
          from: n1.id,
          to: n2.id,
          weight: 0.5,
          entangled: true,
          strength: 0.8,
          isGapJunction: true
        });
      });
    });
    
    setNetwork({ neurons, connections, layers });
    calculateFitness({ neurons, connections });
  };
  
  const generateDNASequence = (length) => {
    const bases = ['A', 'T', 'C', 'G'];
    return Array(length).fill(0).map(() => bases[Math.floor(Math.random() * 4)]).join('');
  };
  
  const calculateDNASimilarity = (seq1, seq2) => {
    let matches = 0;
    const minLen = Math.min(seq1.length, seq2.length);
    for (let i = 0; i < minLen; i++) {
      if (seq1[i] === seq2[i]) matches++;
    }
    return matches / minLen;
  };
  
  const mutateDNA = (sequence, rate) => {
    const bases = ['A', 'T', 'C', 'G'];
    const purines = ['A', 'G'];
    const pyrimidines = ['C', 'T'];
    
    return sequence.split('').map(base => {
      if (Math.random() < rate) {
        // 70% transition, 30% transversion (biological realistic)
        if (Math.random() < 0.7) {
          // Transition
          const isPurine = purines.includes(base);
          const options = isPurine ? purines : pyrimidines;
          return options[Math.floor(Math.random() * options.length)];
        } else {
          // Transversion
          const isPurine = purines.includes(base);
          const options = isPurine ? pyrimidines : purines;
          return options[Math.floor(Math.random() * options.length)];
        }
      }
      return base;
    }).join('');
  };
  
  const calculateFitness = (net) => {
    // Fitness based on:
    // 1. Network connectivity (more connections = better)
    // 2. Energy efficiency (balanced states)
    // 3. DNA diversity (prevent monoculture)
    
    const { neurons, connections } = net;
    
    const connectivityScore = connections.length / (neurons.length * neurons.length);
    
    const energyBalance = neurons.reduce((sum, n) => {
      return sum + (n.energy > 30 && n.energy < 70 ? 1 : 0);
    }, 0) / neurons.length;
    
    const dnaSequences = neurons.map(n => n.dnaSequence);
    const uniqueSequences = new Set(dnaSequences).size;
    const diversityScore = uniqueSequences / dnaSequences.length;
    
    const stateDiversity = new Set(neurons.map(n => n.state)).size / 3;
    
    const fitness = (
      connectivityScore * 0.3 +
      energyBalance * 0.3 +
      diversityScore * 0.2 +
      stateDiversity * 0.2
    );
    
    neurons.forEach(n => n.fitness = fitness);
    
    return fitness;
  };
  
  const evolveNetwork = () => {
    if (!network) return;
    
    // Create mutated offspring
    const offspring = [];
    
    for (let i = 0; i < populationSize; i++) {
      const parent = network.neurons[Math.floor(Math.random() * network.neurons.length)];
      
      // Mutate DNA
      const newDNA = mutateDNA(parent.dnaSequence, mutationRate);
      
      // DNA influences neuron properties
      const dnaToState = (dna) => {
        const purineCount = (dna.match(/[AG]/g) || []).length;
        const total = dna.length;
        const ratio = purineCount / total;
        if (ratio > 0.6) return 1;
        if (ratio < 0.4) return -1;
        return 0;
      };
      
      offspring.push({
        ...parent,
        id: network.neurons.length + i,
        dnaSequence: newDNA,
        state: dnaToState(newDNA),
        fitness: 0
      });
    }
    
    // Selection: keep best performers
    const allNeurons = [...network.neurons, ...offspring];
    allNeurons.forEach(n => {
      n.fitness = calculateFitness({ neurons: [n], connections: network.connections });
    });
    
    allNeurons.sort((a, b) => b.fitness - a.fitness);
    const survivors = allNeurons.slice(0, network.neurons.length);
    
    // Rebuild connections based on new DNA similarities
    const newConnections = [];
    for (let l = 0; l < network.layers.length - 1; l++) {
      const currentLayer = survivors.filter(n => n.layer === l);
      const nextLayer = survivors.filter(n => n.layer === l + 1);
      
      currentLayer.forEach(n1 => {
        nextLayer.forEach(n2 => {
          const similarity = calculateDNASimilarity(n1.dnaSequence, n2.dnaSequence);
          if (Math.random() < similarity * 0.7) {
            newConnections.push({
              from: n1.id,
              to: n2.id,
              weight: (similarity * 2 - 1),
              entangled: similarity > 0.7,
              strength: similarity
            });
          }
        });
      });
    }
    
    const newNetwork = {
      ...network,
      neurons: survivors,
      connections: newConnections
    };
    
    const fitness = calculateFitness(newNetwork);
    
    setNetwork(newNetwork);
    setGeneration(g => g + 1);
    setBestFitness(Math.max(bestFitness, fitness));
    setEvolutionHistory(h => [...h, { generation: generation + 1, fitness }]);
  };
  
  const updateNeuronStates = () => {
    if (!network) return;
    
    const updatedNeurons = network.neurons.map(neuron => {
      // Update based on inputs from connected neurons
      const incoming = network.connections.filter(c => c.to === neuron.id);
      
      let activation = 0;
      incoming.forEach(conn => {
        const sourceNeuron = network.neurons.find(n => n.id === conn.from);
        if (sourceNeuron) {
          activation += sourceNeuron.state * conn.weight * (conn.entangled ? 1.5 : 1.0);
        }
      });
      
      // Apply ternary threshold
      let newState = 0;
      if (activation > 0.5) newState = 1;
      else if (activation < -0.5) newState = -1;
      
      // Calculate energy cost
      const energyCost = Math.abs(neuron.state - newState) * 5;
      const newEnergy = Math.max(0, Math.min(100, neuron.energy - energyCost + 2));
      
      return {
        ...neuron,
        state: newState,
        energy: newEnergy
      };
    });
    
    setNetwork({ ...network, neurons: updatedNeurons });
  };
  
  useEffect(() => {
    if (isRunning) {
      const timer = setInterval(() => {
        updateNeuronStates();
        if (generation % 5 === 0) {
          evolveNetwork();
        }
      }, 500);
      return () => clearInterval(timer);
    }
  }, [isRunning, network, generation]);
  
  // 3D Rendering
  useEffect(() => {
    if (!canvasRef.current || !network) return;
    
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;
    
    // Clear canvas
    ctx.fillStyle = '#0a0a0a';
    ctx.fillRect(0, 0, width, height);
    
    // 3D projection
    const project3D = (x, y, z) => {
      const angleX = viewAngle.x;
      const angleY = viewAngle.y;
      
      // Rotate around Y axis
      let x1 = x * Math.cos(angleY) - z * Math.sin(angleY);
      let z1 = x * Math.sin(angleY) + z * Math.cos(angleY);
      
      // Rotate around X axis
      let y1 = y * Math.cos(angleX) - z1 * Math.sin(angleX);
      let z2 = y * Math.sin(angleX) + z1 * Math.cos(angleX);
      
      // Perspective projection
      const scale = 200 / (z2 + 10);
      const screenX = width / 2 + x1 * scale * zoom;
      const screenY = height / 2 + y1 * scale * zoom;
      
      return { x: screenX, y: screenY, scale, depth: z2 };
    };
    
    // Draw connections first (behind neurons)
    if (network.connections) {
      network.connections.forEach(conn => {
        const from = network.neurons.find(n => n.id === conn.from);
        const to = network.neurons.find(n => n.id === conn.to);
        
        if (from && to) {
          const p1 = project3D(from.x, from.y, from.z);
          const p2 = project3D(to.x, to.y, to.z);
          
          // Skip if behind camera
          if (p1.depth < 0 || p2.depth < 0) return;
          
          ctx.beginPath();
          ctx.moveTo(p1.x, p1.y);
          ctx.lineTo(p2.x, p2.y);
          
          if (showEntanglement && conn.entangled) {
            ctx.strokeStyle = conn.isGapJunction ? '#fbbf24' : '#8b5cf6';
            ctx.lineWidth = 2;
            ctx.setLineDash([5, 5]);
          } else {
            ctx.strokeStyle = `rgba(100, 100, 100, ${conn.strength * 0.5})`;
            ctx.lineWidth = 1;
            ctx.setLineDash([]);
          }
          
          ctx.stroke();
          ctx.setLineDash([]);
        }
      });
    }
    
    // Sort neurons by depth (painter's algorithm)
    const sortedNeurons = [...network.neurons].sort((a, b) => {
      const pa = project3D(a.x, a.y, a.z);
      const pb = project3D(b.x, b.y, b.z);
      return pa.depth - pb.depth;
    });
    
    // Draw neurons
    sortedNeurons.forEach(neuron => {
      const pos = project3D(neuron.x, neuron.y, neuron.z);
      
      if (pos.depth < 0) return; // Behind camera
      
      const size = 8 * pos.scale;
      
      // State color
      let color;
      if (neuron.state === 1) color = '#10b981';
      else if (neuron.state === -1) color = '#ef4444';
      else color = '#6b7280';
      
      // Draw neuron
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, size, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      
      // Pluripotent indicator
      if (neuron.isPluripotent) {
        ctx.strokeStyle = '#fbbf24';
        ctx.lineWidth = 2;
        ctx.stroke();
      }
      
      // Energy level
      if (showEnergy) {
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, size + 3, 0, Math.PI * 2 * (neuron.energy / 100));
        ctx.strokeStyle = `rgba(59, 130, 246, ${neuron.energy / 100})`;
        ctx.lineWidth = 2;
        ctx.stroke();
      }
      
      // DNA label
      ctx.fillStyle = '#ffffff';
      ctx.font = '8px monospace';
      ctx.fillText(neuron.dnaSequence.slice(0, 4), pos.x - 10, pos.y + size + 12);
    });
    
    // Draw layer labels
    ctx.fillStyle = '#9ca3af';
    ctx.font = '12px sans-serif';
    network.layers.forEach((layer, idx) => {
      const pos = project3D(0, -3, idx * 3);
      ctx.fillText(`Layer ${idx + 1}`, pos.x - 30, pos.y);
    });
    
  }, [network, viewAngle, zoom, showEntanglement, showEnergy]);
  
  const handleMouseMove = (e) => {
    if (e.buttons === 1) {
      setViewAngle(prev => ({
        x: prev.x + e.movementY * 0.01,
        y: prev.y + e.movementX * 0.01
      }));
    }
  };
  
  const handleWheel = (e) => {
    e.preventDefault();
    setZoom(prev => Math.max(0.5, Math.min(2.0, prev + e.deltaY * -0.001)));
  };

  return (
    <div className="w-full h-screen bg-gray-900 text-white p-4">
      <div className="max-w-7xl mx-auto h-full flex flex-col">
        <div className="mb-4">
          <h1 className="text-3xl font-bold mb-2">3D Tissue Network Visualization</h1>
          <p className="text-gray-400">DNA-Based Evolutionary Neural Network</p>
        </div>
        
        <div className="grid grid-cols-4 gap-4 mb-4">
          <div className="bg-gray-800 p-4 rounded-lg">
            <div className="flex items-center mb-2">
              <Activity className="w-5 h-5 mr-2 text-blue-500" />
              <span className="font-semibold">Generation</span>
            </div>
            <div className="text-3xl font-bold">{generation}</div>
          </div>
          
          <div className="bg-gray-800 p-4 rounded-lg">
            <div className="flex items-center mb-2">
              <TrendingUp className="w-5 h-5 mr-2 text-green-500" />
              <span className="font-semibold">Best Fitness</span>
            </div>
            <div className="text-3xl font-bold">{(bestFitness * 100).toFixed(1)}%</div>
          </div>
          
          <div className="bg-gray-800 p-4 rounded-lg">
            <div className="flex items-center mb-2">
              <Dna className="w-5 h-5 mr-2 text-purple-500" />
              <span className="font-semibold">Neurons</span>
            </div>
            <div className="text-3xl font-bold">{network?.neurons.length || 0}</div>
          </div>
          
          <div className="bg-gray-800 p-4 rounded-lg">
            <div className="flex items-center mb-2">
              <Zap className="w-5 h-5 mr-2 text-yellow-500" />
              <span className="font-semibold">Connections</span>
            </div>
            <div className="text-3xl font-bold">{network?.connections.length || 0}</div>
          </div>
        </div>
        
        <div className="flex-1 bg-gray-800 rounded-lg overflow-hidden relative">
          <canvas
            ref={canvasRef}
            width={1200}
            height={600}
            className="w-full h-full cursor-move"
            onMouseMove={handleMouseMove}
            onWheel={handleWheel}
          />
          
          <div className="absolute top-4 right-4 bg-gray-900 p-4 rounded-lg space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm">Entanglement</span>
              <input
                type="checkbox"
                checked={showEntanglement}
                onChange={(e) => setShowEntanglement(e.target.checked)}
                className="ml-2"
              />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm">Energy</span>
              <input
                type="checkbox"
                checked={showEnergy}
                onChange={(e) => setShowEnergy(e.target.checked)}
                className="ml-2"
              />
            </div>
          </div>
          
          <div className="absolute bottom-4 left-4 bg-gray-900 p-3 rounded-lg text-xs space-y-1">
            <div className="flex items-center">
              <div className="w-3 h-3 bg-green-500 rounded-full mr-2"></div>
              <span>State: +1</span>
            </div>
            <div className="flex items-center">
              <div className="w-3 h-3 bg-gray-500 rounded-full mr-2"></div>
              <span>State: 0</span>
            </div>
            <div className="flex items-center">
              <div className="w-3 h-3 bg-red-500 rounded-full mr-2"></div>
              <span>State: -1</span>
            </div>
            <div className="flex items-center">
              <div className="w-3 h-3 border-2 border-yellow-500 rounded-full mr-2"></div>
              <span>Pluripotent</span>
            </div>
            <div className="flex items-center">
              <div className="w-8 h-0.5 bg-purple-500 mr-2"></div>
              <span>Entangled</span>
            </div>
            <div className="flex items-center">
              <div className="w-8 h-0.5 bg-yellow-500 mr-2"></div>
              <span>Gap Junction</span>
            </div>
          </div>
        </div>
        
        <div className="mt-4 bg-gray-800 p-4 rounded-lg">
          <div className="grid grid-cols-3 gap-4 mb-4">
            <div>
              <label className="block text-sm mb-2">
                Mutation Rate: {(mutationRate * 100).toFixed(0)}%
              </label>
              <input
                type="range"
                min="0.01"
                max="0.5"
                step="0.01"
                value={mutationRate}
                onChange={(e) => setMutationRate(Number(e.target.value))}
                className="w-full"
              />
            </div>
            
            <div>
              <label className="block text-sm mb-2">
                Selection Pressure: {(selectionPressure * 100).toFixed(0)}%
              </label>
              <input
                type="range"
                min="0.3"
                max="0.9"
                step="0.1"
                value={selectionPressure}
                onChange={(e) => setSelectionPressure(Number(e.target.value))}
                className="w-full"
              />
            </div>
            
            <div>
              <label className="block text-sm mb-2">
                Zoom: {zoom.toFixed(1)}x
              </label>
              <input
                type="range"
                min="0.5"
                max="2.0"
                step="0.1"
                value={zoom}
                onChange={(e) => setZoom(Number(e.target.value))}
                className="w-full"
              />
            </div>
          </div>
          
          <div className="flex gap-2">
            <button
              onClick={() => setIsRunning(!isRunning)}
              className={`flex-1 py-3 px-6 rounded-lg font-semibold flex items-center justify-center ${
                isRunning ? 'bg-red-600 hover:bg-red-700' : 'bg-green-600 hover:bg-green-700'
              }`}
            >
              {isRunning ? <Pause className="w-5 h-5 mr-2" /> : <Play className="w-5 h-5 mr-2" />}
              {isRunning ? 'Pause' : 'Start'} Evolution
            </button>
            
            <button
              onClick={evolveNetwork}
              disabled={isRunning}
              className="py-3 px-6 bg-blue-600 hover:bg-blue-700 rounded-lg font-semibold disabled:opacity-50"
            >
              Evolve Generation
            </button>
            
            <button
              onClick={() => {
                setIsRunning(false);
                setGeneration(0);
                setBestFitness(0);
                setEvolutionHistory([]);
                initializeNetwork();
              }}
              className="py-3 px-6 bg-gray-600 hover:bg-gray-700 rounded-lg font-semibold flex items-center"
            >
              <RotateCcw className="w-5 h-5 mr-2" />
              Reset
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default TissueVisualization3D;